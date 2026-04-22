import argparse
import json
from pathlib import Path


def build_parser():
    parser = argparse.ArgumentParser(description="Train a PEFT LoRA adapter for SFT.")
    parser.add_argument("--model", required=True)
    parser.add_argument("--data-dir", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--iters", type=int, default=40)
    parser.add_argument("--batch-size", type=int, default=1)
    parser.add_argument("--learning-rate", type=float, default=1e-6)
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


def messages_to_text(tokenizer, row):
    messages = row.get("messages")
    if isinstance(messages, list) and messages:
        return tokenizer.apply_chat_template(
            messages,
            tokenize=False,
            add_generation_prompt=False,
        )

    prompt = row.get("prompt") or row.get("input") or ""
    completion = row.get("completion") or row.get("output") or ""
    return f"{prompt}{completion}"


def main():
    args = build_parser().parse_args()

    import torch
    from datasets import Dataset
    from peft import LoraConfig, TaskType, get_peft_model
    from transformers import (
        AutoModelForCausalLM,
        AutoTokenizer,
        DataCollatorForLanguageModeling,
        Trainer,
        TrainingArguments,
    )

    train_rows = load_jsonl(Path(args.data_dir) / "train.jsonl")
    valid_rows = load_jsonl(Path(args.data_dir) / "valid.jsonl")
    if not train_rows:
        raise ValueError("SFT train dataset is empty.")

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    tokenizer = AutoTokenizer.from_pretrained(args.model, trust_remote_code=True)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    def to_text_dataset(rows):
        return Dataset.from_list(
            [{"text": messages_to_text(tokenizer, row)} for row in rows]
        )

    train_dataset = to_text_dataset(train_rows)
    eval_dataset = to_text_dataset(valid_rows) if valid_rows else None

    def tokenize(batch):
        tokenized = tokenizer(
            batch["text"],
            truncation=True,
            max_length=args.max_seq_length,
            padding="max_length",
        )
        tokenized["labels"] = [ids[:] for ids in tokenized["input_ids"]]
        return tokenized

    train_dataset = train_dataset.map(tokenize, batched=True, remove_columns=["text"])
    if eval_dataset is not None:
        eval_dataset = eval_dataset.map(tokenize, batched=True, remove_columns=["text"])

    use_mps = torch.backends.mps.is_available()
    model = AutoModelForCausalLM.from_pretrained(
        args.model,
        trust_remote_code=True,
        low_cpu_mem_usage=True,
        torch_dtype=torch.float16 if use_mps else None,
    )
    model.config.use_cache = False
    peft_config = LoraConfig(
        task_type=TaskType.CAUSAL_LM,
        r=8,
        lora_alpha=16,
        lora_dropout=0.0,
        target_modules=[
            "q_proj",
            "k_proj",
            "v_proj",
            "o_proj",
            "up_proj",
            "down_proj",
            "gate_proj",
        ],
    )
    model = get_peft_model(model, peft_config)
    model.gradient_checkpointing_enable()

    training_args = TrainingArguments(
        output_dir=str(output_dir / "checkpoints"),
        per_device_train_batch_size=args.batch_size,
        per_device_eval_batch_size=args.batch_size,
        max_steps=args.iters,
        learning_rate=args.learning_rate,
        logging_steps=max(1, min(args.iters, 10)),
        save_strategy="no",
        eval_strategy="steps" if eval_dataset is not None else "no",
        eval_steps=max(1, min(args.iters, 10)) if eval_dataset is not None else None,
        report_to=[],
        remove_unused_columns=False,
        dataloader_num_workers=0,
        gradient_checkpointing=True,
        use_cpu=not use_mps,
    )

    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=train_dataset,
        eval_dataset=eval_dataset,
        data_collator=DataCollatorForLanguageModeling(tokenizer=tokenizer, mlm=False),
    )
    trainer.train()
    model.save_pretrained(str(output_dir))
    tokenizer.save_pretrained(str(output_dir))


if __name__ == "__main__":
    main()
