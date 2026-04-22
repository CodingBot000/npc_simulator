import argparse
import json
from pathlib import Path


def build_parser():
    parser = argparse.ArgumentParser(description="Train a PEFT LoRA adapter with DPO.")
    parser.add_argument("--model", required=True)
    parser.add_argument("--data-dir", required=True)
    parser.add_argument("--reference-adapter-dir", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--iters", type=int, default=30)
    parser.add_argument("--batch-size", type=int, default=1)
    parser.add_argument("--learning-rate", type=float, default=5e-7)
    parser.add_argument("--num-layers", type=int, default=None)
    parser.add_argument("--steps-per-report", type=int, default=5)
    parser.add_argument("--steps-per-eval", type=int, default=10)
    parser.add_argument("--save-every", type=int, default=10)
    parser.add_argument("--beta", type=float, default=0.1)
    parser.add_argument("--max-seq-length", type=int, default=2048)
    return parser


def load_jsonl(path: Path):
    rows = []
    if not path.exists():
        return rows
    with path.open("r", encoding="utf8") as handle:
        for line in handle:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def build_prompt(tokenizer, prompt_messages):
    return tokenizer.apply_chat_template(
        prompt_messages,
        tokenize=False,
        add_generation_prompt=True,
    )


def main():
    args = build_parser().parse_args()

    from datasets import Dataset
    from peft import PeftModel
    from trl import DPOConfig, DPOTrainer
    from transformers import AutoModelForCausalLM, AutoTokenizer

    train_rows = load_jsonl(Path(args.data_dir) / "train.jsonl")
    valid_rows = load_jsonl(Path(args.data_dir) / "valid.jsonl")
    if not train_rows:
        raise ValueError("DPO train dataset is empty.")

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    tokenizer = AutoTokenizer.from_pretrained(args.model, trust_remote_code=True)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    def convert_rows(rows):
        converted = []
        for row in rows:
            prompt_messages = row.get("promptMessages")
            chosen = row.get("chosen")
            rejected = row.get("rejected")
            if not isinstance(prompt_messages, list) or not chosen or not rejected:
                continue
            converted.append(
                {
                    "prompt": build_prompt(tokenizer, prompt_messages),
                    "chosen": chosen,
                    "rejected": rejected,
                }
            )
        return Dataset.from_list(converted)

    train_dataset = convert_rows(train_rows)
    eval_dataset = convert_rows(valid_rows) if valid_rows else None

    if len(train_dataset) == 0:
        raise ValueError("DPO dataset has no valid rows.")

    base_model = AutoModelForCausalLM.from_pretrained(
        args.model,
        trust_remote_code=True,
    )
    policy_model = PeftModel.from_pretrained(
        base_model,
        args.reference_adapter_dir,
        is_trainable=True,
    )
    ref_base_model = AutoModelForCausalLM.from_pretrained(
        args.model,
        trust_remote_code=True,
    )
    ref_model = PeftModel.from_pretrained(
        ref_base_model,
        args.reference_adapter_dir,
        is_trainable=False,
    )

    training_args = DPOConfig(
        output_dir=str(output_dir / "checkpoints"),
        per_device_train_batch_size=args.batch_size,
        per_device_eval_batch_size=args.batch_size,
        max_steps=args.iters,
        learning_rate=args.learning_rate,
        beta=args.beta,
        logging_steps=max(1, min(args.iters, args.steps_per_report)),
        save_strategy="no",
        eval_strategy="steps" if eval_dataset is not None else "no",
        eval_steps=max(1, min(args.iters, args.steps_per_eval))
        if eval_dataset is not None
        else None,
        report_to=[],
        max_prompt_length=args.max_seq_length,
        max_length=args.max_seq_length,
    )

    trainer = DPOTrainer(
        model=policy_model,
        ref_model=ref_model,
        args=training_args,
        train_dataset=train_dataset,
        eval_dataset=eval_dataset,
        processing_class=tokenizer,
    )
    trainer.train()
    policy_model.save_pretrained(str(output_dir))
    tokenizer.save_pretrained(str(output_dir))


if __name__ == "__main__":
    main()
