import argparse
import json
import math
import random
import shutil
import time
from pathlib import Path

import mlx.core as mx
import mlx.nn as nn
import mlx.optimizers as optim
from mlx.utils import tree_flatten

from mlx_lm.tuner.utils import load_adapters
from mlx_lm.utils import load


def build_parser():
    parser = argparse.ArgumentParser(description="Minimal MLX DPO trainer for local adapters.")
    parser.add_argument("--model", required=True, help="Base model repo or local path.")
    parser.add_argument("--data-dir", required=True, help="Directory with train.jsonl and valid.jsonl.")
    parser.add_argument(
        "--reference-adapter-path",
        required=True,
        help="Reference SFT adapter directory.",
    )
    parser.add_argument("--adapter-path", required=True, help="Output adapter directory.")
    parser.add_argument("--iters", type=int, default=30)
    parser.add_argument("--batch-size", type=int, default=1)
    parser.add_argument("--learning-rate", type=float, default=5e-7)
    parser.add_argument("--steps-per-report", type=int, default=5)
    parser.add_argument("--steps-per-eval", type=int, default=10)
    parser.add_argument("--save-every", type=int, default=10)
    parser.add_argument("--beta", type=float, default=0.1)
    parser.add_argument("--max-seq-length", type=int, default=2048)
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--num-layers", type=int, default=2)
    return parser


def load_jsonl(path: Path):
    if not path.exists():
      return []

    rows = []
    with path.open("r", encoding="utf8") as handle:
        for line in handle:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def prepare_example(row, tokenizer, max_seq_length):
    prompt_messages = row["promptMessages"]
    chosen_messages = [*prompt_messages, {"role": "assistant", "content": row["chosen"]}]
    rejected_messages = [*prompt_messages, {"role": "assistant", "content": row["rejected"]}]

    prompt_tokens = tokenizer.apply_chat_template(
        prompt_messages,
        add_generation_prompt=True,
        return_dict=False,
    )
    chosen_tokens = tokenizer.apply_chat_template(chosen_messages, return_dict=False)
    rejected_tokens = tokenizer.apply_chat_template(rejected_messages, return_dict=False)

    prompt_tokens = prompt_tokens[:max_seq_length]
    chosen_tokens = chosen_tokens[:max_seq_length]
    rejected_tokens = rejected_tokens[:max_seq_length]

    if len(chosen_tokens) <= 1 or len(rejected_tokens) <= 1:
        raise ValueError(f"Preference row {row.get('pairId', 'unknown')} is too short.")

    return {
        "pairId": row.get("pairId", "unknown"),
        "prompt_len": min(len(prompt_tokens), max_seq_length),
        "chosen_tokens": mx.array(chosen_tokens, dtype=mx.int32),
        "rejected_tokens": mx.array(rejected_tokens, dtype=mx.int32),
    }


def sequence_mean_logprob(model, tokens: mx.array, prompt_len: int):
    batch = tokens[None, :]
    inputs = batch[:, :-1]
    targets = batch[:, 1:]

    logits = model(inputs)
    log_probs = logits - mx.logsumexp(logits, axis=-1, keepdims=True)
    target_log_probs = mx.take_along_axis(log_probs, targets[..., None], axis=-1).squeeze(-1)

    mask = (mx.arange(targets.shape[1]) >= max(prompt_len - 1, 0))[None, :]
    masked = target_log_probs * mask
    token_count = mx.maximum(mask.sum(), 1)
    return masked.sum() / token_count


def dpo_batch_loss(policy_model, reference_model, batch, beta):
    loss_total = mx.array(0.0)
    reward_total = mx.array(0.0)
    accuracy_total = mx.array(0.0)

    for example in batch:
        policy_chosen = sequence_mean_logprob(
            policy_model,
            example["chosen_tokens"],
            example["prompt_len"],
        )
        policy_rejected = sequence_mean_logprob(
            policy_model,
            example["rejected_tokens"],
            example["prompt_len"],
        )
        reference_chosen = mx.stop_gradient(
            sequence_mean_logprob(
                reference_model,
                example["chosen_tokens"],
                example["prompt_len"],
            )
        )
        reference_rejected = mx.stop_gradient(
            sequence_mean_logprob(
                reference_model,
                example["rejected_tokens"],
                example["prompt_len"],
            )
        )

        margin = beta * (
            (policy_chosen - policy_rejected)
            - (reference_chosen - reference_rejected)
        )
        loss_total = loss_total + mx.logaddexp(mx.array(0.0), -margin)
        reward_total = reward_total + margin
        accuracy_total = accuracy_total + (margin > 0).astype(mx.float32)

    batch_size = max(len(batch), 1)
    return (
        loss_total / batch_size,
        reward_total / batch_size,
        accuracy_total / batch_size,
    )


def evaluate(policy_model, reference_model, dataset, beta):
    if not dataset:
        return None

    losses = []
    rewards = []
    accuracies = []

    policy_model.eval()
    reference_model.eval()

    for example in dataset:
        loss, reward, accuracy = dpo_batch_loss(policy_model, reference_model, [example], beta)
        losses.append(loss)
        rewards.append(reward)
        accuracies.append(accuracy)

    loss_value = mx.stack(losses).mean().item()
    reward_value = mx.stack(rewards).mean().item()
    accuracy_value = mx.stack(accuracies).mean().item()
    return {
        "loss": loss_value,
        "reward": reward_value,
        "accuracy": accuracy_value,
    }


def save_adapter(model, adapter_path: Path):
    adapter_path.mkdir(parents=True, exist_ok=True)
    adapter_weights = dict(tree_flatten(model.trainable_parameters()))
    mx.save_safetensors(str(adapter_path / "adapters.safetensors"), adapter_weights)


def main():
    args = build_parser().parse_args()
    random.seed(args.seed)
    mx.random.seed(args.seed)

    data_dir = Path(args.data_dir)
    reference_adapter_path = Path(args.reference_adapter_path)
    adapter_path = Path(args.adapter_path)
    adapter_path.mkdir(parents=True, exist_ok=True)

    if not reference_adapter_path.exists():
        raise FileNotFoundError(f"Reference adapter path does not exist: {reference_adapter_path}")

    train_rows = load_jsonl(data_dir / "train.jsonl")
    valid_rows = load_jsonl(data_dir / "valid.jsonl")
    if not train_rows:
        raise ValueError("DPO train dataset is empty.")

    print("Loading policy model", flush=True)
    policy_model, tokenizer = load(args.model, tokenizer_config={"trust_remote_code": True})
    policy_model.freeze()
    load_adapters(policy_model, str(reference_adapter_path))

    print("Loading reference model", flush=True)
    reference_model, _ = load(args.model, tokenizer_config={"trust_remote_code": True})
    reference_model.freeze()
    load_adapters(reference_model, str(reference_adapter_path))
    reference_model.freeze()

    train_dataset = [
        prepare_example(row, tokenizer, args.max_seq_length) for row in train_rows
    ]
    valid_dataset = [
        prepare_example(row, tokenizer, args.max_seq_length) for row in valid_rows
    ]

    optimizer = optim.Adam(learning_rate=args.learning_rate)
    loss_value_and_grad = nn.value_and_grad(
        policy_model,
        lambda model, batch: dpo_batch_loss(model, reference_model, batch, args.beta)[0],
    )

    reference_config = reference_adapter_path / "adapter_config.json"
    if reference_config.exists():
        shutil.copy2(reference_config, adapter_path / "adapter_config.json")
    with (adapter_path / "dpo_config.json").open("w", encoding="utf8") as handle:
        json.dump(vars(args), handle, indent=2)

    print(f"Starting DPO training, train={len(train_dataset)}, valid={len(valid_dataset)}", flush=True)

    started_at = time.perf_counter()
    for iteration in range(1, args.iters + 1):
        batch = random.sample(train_dataset, k=min(args.batch_size, len(train_dataset)))
        tic = time.perf_counter()
        loss, grads = loss_value_and_grad(policy_model, batch)
        optimizer.update(policy_model, grads)
        mx.eval(policy_model.parameters(), optimizer.state, loss)
        step_time = time.perf_counter() - tic

        if iteration % args.steps_per_report == 0 or iteration == args.iters:
            batch_loss, batch_reward, batch_accuracy = dpo_batch_loss(
                policy_model,
                reference_model,
                batch,
                args.beta,
            )
            mx.eval(batch_loss, batch_reward, batch_accuracy)
            print(
                f"Iter {iteration}: "
                f"loss {batch_loss.item():.4f}, "
                f"reward {batch_reward.item():.4f}, "
                f"accuracy {batch_accuracy.item():.4f}, "
                f"step_time {step_time:.3f}s",
                flush=True,
            )

        if valid_dataset and (
            iteration == 1 or iteration % args.steps_per_eval == 0 or iteration == args.iters
        ):
            evaluation = evaluate(policy_model, reference_model, valid_dataset, args.beta)
            if evaluation:
                print(
                    f"Iter {iteration}: "
                    f"val_loss {evaluation['loss']:.4f}, "
                    f"val_reward {evaluation['reward']:.4f}, "
                    f"val_accuracy {evaluation['accuracy']:.4f}",
                    flush=True,
                )

        if iteration % args.save_every == 0:
            save_adapter(policy_model, adapter_path)
            checkpoint_path = adapter_path / f"{iteration:07d}_adapters.safetensors"
            adapter_weights = dict(tree_flatten(policy_model.trainable_parameters()))
            mx.save_safetensors(str(checkpoint_path), adapter_weights)
            print(f"Iter {iteration}: saved checkpoint to {checkpoint_path}", flush=True)

    save_adapter(policy_model, adapter_path)
    duration = time.perf_counter() - started_at
    print(
        f"Finished DPO training in {duration:.2f}s. Saved adapter to {adapter_path}",
        flush=True,
    )


if __name__ == "__main__":
    main()
