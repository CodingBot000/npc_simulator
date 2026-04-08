import { NextResponse } from "next/server";
import { z } from "zod";
import { playerActions } from "@/lib/types";
import { interactWithNpc } from "@/server/engine/npc-engine";

export const runtime = "nodejs";

const requestSchema = z.object({
  npcId: z.string().min(1),
  inputMode: z.enum(["free_text", "action"]),
  text: z.string(),
  action: z.enum(playerActions).nullable(),
  playerId: z.string().min(1),
});

export async function POST(request: Request) {
  try {
    const payload = requestSchema.parse(await request.json());
    return NextResponse.json(await interactWithNpc(payload));
  } catch (error) {
    return NextResponse.json(
      {
        message:
          error instanceof Error
            ? error.message
            : "상호작용 처리 중 오류가 발생했습니다.",
      },
      { status: 500 },
    );
  }
}
