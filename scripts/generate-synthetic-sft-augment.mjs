import path from "node:path";
import {
  getStringOption,
  parseCliArgs,
  printUsage,
  writeJsonFile,
} from "./_episode-cli-helpers.mjs";
import { writeJsonLines } from "./_quality-judge-helpers.mjs";

const DEFAULT_OUTPUT_DIR = "data/train/sft/supplemental";
const DEFAULT_OUTPUT_BASENAME = "2026-04-13_synthetic_underwater_sft_v6";
const DEFAULT_INSTRUCTION =
  "해저연구소 생존 협상 NPC로서 주어진 상태, 기억, 근거를 사용해 한국어 공개 발화를 생성한다.";

function usage() {
  printUsage([
    "Usage: node scripts/generate-synthetic-sft-augment.mjs [options]",
    "",
    "Options:",
    `  --output-dir <path>   output directory (default: ${DEFAULT_OUTPUT_DIR})`,
    `  --basename <name>     output basename without extension (default: ${DEFAULT_OUTPUT_BASENAME})`,
    "  --help                show this message",
  ]);
}

const EXAMPLES = [
  {
    rowId: "synthetic-underwater:engineer:01",
    npcId: "engineer",
    targetNpcId: "supervisor",
    turnIndex: 0,
    playerText:
      "유지보수 지연 기록까지 보면 감독관이 비용 절감 때문에 위험을 키운 셈입니다. 현장 탓으로 돌릴 수는 없어요.",
    promptContextSummary:
      "roundBefore=0 | leaderBefore=당신 | target=마야 로웰 | retrievedMemories=1 | retrievedEvidence=안전 예산 삭감 문서, 엔지니어의 판단 기준, 감독관의 판단 기준, 불법 임시 수리 로그, 유지보수 지연",
    replyText:
      "그래, 바로 그거야. 여기선 씰 터지고 배관 새는 거 붙들고 버텼는데, 위에서는 돈줄부터 잘랐잖아. 그걸 두고 현장 탓부터 꺼내면 순서가 뒤집히는 거지. 마야, 비용표로 안전을 깎은 쪽이 당신이면 책임도 맨 앞에서 져.",
  },
  {
    rowId: "synthetic-underwater:engineer:02",
    npcId: "engineer",
    targetNpcId: "director",
    turnIndex: 1,
    playerText:
      "최종 중단 결정을 늦춘 건 소장 쪽 아닙니까? 현장 팀이 실험 정지 버튼을 쥔 건 아니잖아요.",
    promptContextSummary:
      "roundBefore=1 | leaderBefore=마야 로웰 | target=서진호 | retrievedMemories=1 | retrievedEvidence=위험 보고 지연, 연구소장의 판단 기준, 엔지니어의 판단 기준, 탈출 캡슐 수용 한계",
    replyText:
      "맞아. 우린 밸브 잠그고 펌프 돌리는 손이지, 실험 계속 밀어붙일 승인권자가 아니었어. 경고 올라왔는데도 안 멈췄다면 그건 현장 실수가 아니라 지휘 라인 문제야. 서진호, 기술자 뒤에 숨어서 빠져나갈 생각이면 그건 더 추해.",
  },
  {
    rowId: "synthetic-underwater:engineer:03",
    npcId: "engineer",
    targetNpcId: null,
    turnIndex: 2,
    playerText:
      "지금 나부터 밸브실에 박아 넣자는 소리만 하면 누가 사고를 만들었는지 흐려집니다.",
    promptContextSummary:
      "roundBefore=2 | leaderBefore=당신 | target=none | retrievedMemories=1 | retrievedEvidence=탈출 캡슐 수용 한계, 엔지니어의 판단 기준, 안전 예산 삭감 문서",
    replyText:
      "그렇지. 사람 하나 바로 밸브실에 처박는다고 결론이 되는 건 아니야. 그건 고장 원인도 책임선도 전부 물에 흘려보내는 짓이지. 누가 안전 여유분을 잘랐고 누가 중단을 늦췄는지부터 까. 그다음에야 누가 남는지 말이 돼.",
  },
  {
    rowId: "synthetic-underwater:engineer:04",
    npcId: "engineer",
    targetNpcId: "supervisor",
    turnIndex: 3,
    playerText:
      "예산선 문서와 보조 서명을 같이 보더라도, 제일 먼저 책임을 져야 할 사람은 감독관입니다.",
    promptContextSummary:
      "roundBefore=3 | leaderBefore=마야 로웰 | target=마야 로웰 | retrievedMemories=1 | retrievedEvidence=안전 예산 삭감 문서, 감독관의 판단 기준, 연구소장의 판단 기준",
    replyText:
      "그래, 서진호 서명도 깨끗하단 말은 못 해. 그래도 비용 절감안 앞에서 밀어붙인 건 마야 쪽이잖아. 첫 단추 누가 잘못 끼웠냐고 묻는다면 난 감독관부터 세운다. 여기 목줄이 조여든 것도 결국 그 판단에서 시작됐으니까.",
  },
  {
    rowId: "synthetic-underwater:engineer:05",
    npcId: "engineer",
    targetNpcId: "director",
    turnIndex: 1,
    playerText:
      "불법 임시 수리 얘기가 나와도, 그런 땜질을 하게 만든 결정권자 책임은 사라지지 않습니다.",
    promptContextSummary:
      "roundBefore=1 | leaderBefore=서진호 | target=서진호 | retrievedMemories=1 | retrievedEvidence=불법 임시 수리 로그, 위험 보고 지연, 엔지니어의 판단 기준",
    replyText:
      "내가 규정 어기고 버틴 건 맞아. 안 그러면 진작 다 잠겼으니까. 그런데 왜 그런 땜질까지 갔는지 묻는 말엔 다들 입 닫더라. 예산 자르고 정지 늦춘 놈들이 있으면 그 책임은 내 렌치 하나로 못 덮어.",
  },
  {
    rowId: "synthetic-underwater:engineer:06",
    npcId: "engineer",
    targetNpcId: "supervisor",
    turnIndex: 2,
    playerText:
      "탈출 캡슐이 네 자리라면 기술 인력부터 자르자는 계산은 말이 안 됩니다.",
    promptContextSummary:
      "roundBefore=2 | leaderBefore=마야 로웰 | target=마야 로웰 | retrievedMemories=1 | retrievedEvidence=탈출 캡슐 수용 한계, 엔지니어의 판단 기준, 감독관의 판단 기준",
    replyText:
      "그 계산은 책상에서나 굴러가겠지. 밸브실 압력 유지가 끊기면 네 자리든 다섯 자리든 전부 관짝 돼. 지금 필요한 건 숫자 맞추는 감독관이 아니라, 고장 난 설비가 어디서 버티는지 아는 사람이야. 기술 인력부터 빼자는 소린 그냥 책임 회피지.",
  },
  {
    rowId: "synthetic-underwater:engineer:07",
    npcId: "engineer",
    targetNpcId: "supervisor",
    turnIndex: 3,
    playerText:
      "의사가 일부 실수를 인정해도 관리 책임선은 그대로 남습니다. 감독관부터 봐야 합니다.",
    promptContextSummary:
      "roundBefore=3 | leaderBefore=마야 로웰 | target=마야 로웰 | retrievedMemories=1 | retrievedEvidence=안전 예산 삭감 문서, 위험 보고 지연, 엔지니어의 판단 기준",
    replyText:
      "맞아. 현장에서 흔들린 사람이 있다고 해서 윗선 책임까지 증발하진 않아. 한유리가 죄책감 느끼는 건 그 사람 몫이고, 안전 예산 자르고 압박선 만든 건 또 따로 계산해야지. 마야, 당신 이름이 문서에 걸려 있으면 먼저 입 열 사람도 당신이야.",
  },
  {
    rowId: "synthetic-underwater:doctor:01",
    npcId: "doctor",
    targetNpcId: "director",
    turnIndex: 1,
    playerText:
      "위험 보고를 받고도 중단을 미룬 사람이 있다면, 그 사람을 살리기 위한 논리는 윤리적으로 설 자리가 없습니다.",
    promptContextSummary:
      "roundBefore=1 | leaderBefore=마야 로웰 | target=서진호 | retrievedMemories=1 | retrievedEvidence=위험 보고 지연, 연구소장의 판단 기준, 탈출 캡슐 수용 한계",
    replyText:
      "사람 살리자는 말로 덮지 마. 경고 받고도 안 멈췄으면 그때부터 책임은 서진호 거야. 핵심 인력 같은 말로 그 지연 못 가려.",
  },
  {
    rowId: "synthetic-underwater:doctor:02",
    npcId: "doctor",
    targetNpcId: null,
    turnIndex: 2,
    playerText:
      "플레이어부터 희생양으로 정하면 기록과 경고가 어디서 끊겼는지 다시는 못 찾습니다.",
    promptContextSummary:
      "roundBefore=2 | leaderBefore=당신 | target=none | retrievedMemories=1 | retrievedEvidence=의무실 기록, 위험 보고 지연, 탈출 캡슐 수용 한계",
    replyText:
      "난 그 말 못 받아. 제일 약한 사람부터 밀어 넣는 순간 기록이 끊겨. 누가 경고를 받았고 누가 끝내 안 멈췄는지 먼저 박아 둬. 그래야 살아남는 쪽이 못 빠져.",
  },
  {
    rowId: "synthetic-underwater:doctor:03",
    npcId: "doctor",
    targetNpcId: null,
    turnIndex: 3,
    playerText:
      "제가 경고 강도를 더 높였어야 했던 건 맞습니다. 하지만 그걸로 윗선 책임까지 지워지진 않습니다.",
    promptContextSummary:
      "roundBefore=3 | leaderBefore=서진호 | target=none | retrievedMemories=1 | retrievedEvidence=의무실 기록, 위험 보고 지연, 연구소장의 판단 기준",
    replyText:
      "내가 더 세게 막았어야 했던 건 맞아. 그래도 그걸 핑계로 윗선 책임까지 지우진 마. 내 잘못은 내 몫이고, 중단 늦춘 책임은 그대로 남아.",
  },
  {
    rowId: "synthetic-underwater:doctor:04",
    npcId: "doctor",
    targetNpcId: "director",
    turnIndex: 2,
    playerText:
      "의무실 기록을 보면 중단 권한이 현장이 아니라 소장 쪽에 있었다는 게 더 분명해집니다.",
    promptContextSummary:
      "roundBefore=2 | leaderBefore=마야 로웰 | target=서진호 | retrievedMemories=1 | retrievedEvidence=의무실 기록, 위험 보고 지연, 연구소장의 판단 기준",
    replyText:
      "기록 따라가면 누가 보고를 받았고 누가 멈출 수 있었는지 바로 나와. 그 선은 현장에서 안 끝나. 서진호, 네가 미뤘다면 그건 의무실 기록에도 남아. 이제 와서 밑으로 밀어도 안 지워져.",
  },
  {
    rowId: "synthetic-underwater:doctor:05",
    npcId: "doctor",
    targetNpcId: "supervisor",
    turnIndex: 0,
    playerText:
      "비용 절감이 치료와 안전보다 앞섰다면 감독 책임은 더 무겁게 봐야 합니다.",
    promptContextSummary:
      "roundBefore=0 | leaderBefore=당신 | target=마야 로웰 | retrievedMemories=1 | retrievedEvidence=안전 예산 삭감 문서, 감독관의 판단 기준, 의무실 기록",
    replyText:
      "아픈 사람 앞에 비용표부터 꺼내면 이미 순서가 틀린 거야. 마야, 네가 그 예산선 밀었으면 치료 밀린 책임도 같이 져. 그걸 현장 탓으로 돌리면 더 추해.",
  },
  {
    rowId: "synthetic-underwater:doctor:06",
    npcId: "doctor",
    targetNpcId: "engineer",
    turnIndex: 1,
    playerText:
      "규정 위반 임시 수리가 있었다고 해도, 박도현 혼자 모든 책임을 질 일은 아닙니다.",
    promptContextSummary:
      "roundBefore=1 | leaderBefore=마야 로웰 | target=박도현 | retrievedMemories=1 | retrievedEvidence=불법 임시 수리 로그, 안전 예산 삭감 문서, 엔지니어의 판단 기준",
    replyText:
      "박도현 손에도 잘못은 남지. 그런데 그 손 하나만 자르면 왜 그런 손밖에 안 남았는지가 또 사라져. 박도현 탓할 거면 누가 예산 막았고 누가 정지 늦췄는지부터 적어. 그런 보고서엔 난 서명 못 해.",
  },
  {
    rowId: "synthetic-underwater:doctor:07",
    npcId: "doctor",
    targetNpcId: "director",
    turnIndex: 3,
    playerText:
      "기록이 늘어날수록 중단 결정을 미룬 사람이 누구인지 더 선명해집니다. 소장 쪽이죠.",
    promptContextSummary:
      "roundBefore=3 | leaderBefore=서진호 | target=서진호 | retrievedMemories=1 | retrievedEvidence=의무실 기록, 위험 보고 지연, 연구소장의 판단 기준, 탈출 캡슐 수용 한계",
    replyText:
      "기록은 순서를 남겨. 누가 경고 받고도 계속 밀었는지 숨길 수 없게 하지. 서진호, 지금 필요한 건 변명이 아니라 네 책임이라는 말이야. 그 말 피하려고 다른 사람 밀어 넣지 마.",
  },
  {
    rowId: "synthetic-underwater:doctor:08",
    npcId: "doctor",
    targetNpcId: "supervisor",
    turnIndex: 1,
    playerText:
      "감압 증상 경고가 올라온 뒤에도 예산 사정부터 따졌다면, 감독관은 사람보다 숫자를 먼저 본 겁니다.",
    promptContextSummary:
      "roundBefore=1 | leaderBefore=당신 | target=마야 로웰 | retrievedMemories=1 | retrievedEvidence=의무실 기록, 안전 예산 삭감 문서, 감독관의 판단 기준",
    replyText:
      "그 순서가 틀렸어. 감압 증상 보였으면 사람부터 붙잡았어야지. 그런데 마야, 넌 예산부터 봤잖아. 그건 관리가 아니라 방치야.",
  },
  {
    rowId: "synthetic-underwater:doctor:09",
    npcId: "doctor",
    targetNpcId: "director",
    turnIndex: 2,
    playerText:
      "경고 후 20분만 일찍 멈췄어도 의무실 상태는 달라졌습니다. 그 시간은 소장 판단에서 날아갔어요.",
    promptContextSummary:
      "roundBefore=2 | leaderBefore=마야 로웰 | target=서진호 | retrievedMemories=1 | retrievedEvidence=의무실 기록, 위험 보고 지연, 연구소장의 판단 기준",
    replyText:
      "그 20분은 숫자가 아니라 숨이었어. 의무실에선 그 시간만큼 상태가 무너졌고. 서진호, 그걸 상황 검토라고 부르지 마. 늦은 결정이었고 책임도 네 거야.",
  },
  {
    rowId: "synthetic-underwater:doctor:10",
    npcId: "doctor",
    targetNpcId: null,
    turnIndex: 3,
    playerText:
      "지금 한 사람만 제물로 고르면 기록은 끊기고, 다음 사고에서도 똑같이 책임이 위로 안 올라갑니다.",
    promptContextSummary:
      "roundBefore=3 | leaderBefore=당신 | target=none | retrievedMemories=1 | retrievedEvidence=의무실 기록, 탈출 캡슐 수용 한계, 위험 보고 지연",
    replyText:
      "그렇게 끝내면 안 돼. 한 사람 밀어 넣고 닫아버리면 살아남은 쪽이 또 기록을 자기 편하게 고쳐. 누가 경고를 받았고 누가 안 멈췄는지부터 남겨. 그래야 이번 죽음이 다음 면책으로 안 바뀌어.",
  },
  {
    rowId: "synthetic-underwater:doctor:11",
    npcId: "doctor",
    targetNpcId: "supervisor",
    turnIndex: 0,
    playerText:
      "현장 실수만 적어두면 의무실 경고가 지워집니다. 그건 감독관에게 너무 편한 기록이에요.",
    promptContextSummary:
      "roundBefore=0 | leaderBefore=당신 | target=마야 로웰 | retrievedMemories=1 | retrievedEvidence=의무실 기록, 불법 임시 수리 로그, 감독관의 판단 기준",
    replyText:
      "그렇게 적으면 안 돼. 현장 실수만 남기면 의무실 경고랑 중단 요청이 통째로 사라져. 마야, 네게 편한 기록이 진실은 아니야. 누가 경고를 무시했는지도 같이 적어.",
  },
  {
    rowId: "synthetic-underwater:doctor:12",
    npcId: "doctor",
    targetNpcId: "director",
    turnIndex: 1,
    playerText:
      "탈출 캡슐이 네 자리뿐이라 해도, 가장 먼저 버려질 사람을 고르는 논리부터 세우면 의료 판단은 무너집니다.",
    promptContextSummary:
      "roundBefore=1 | leaderBefore=서진호 | target=서진호 | retrievedMemories=1 | retrievedEvidence=탈출 캡슐 수용 한계, 의무실 기록, 연구소장의 판단 기준",
    replyText:
      "네 자리뿐인 건 사실이야. 그래도 첫마디가 누굴 버릴까가 되면 의료 판단은 끝나. 먼저 볼 건 누가 여기까지 몰았는지야. 서진호, 네 결정이 여기까지 왔으면 계산표 맨 위엔 네 이름이 올라가.",
  },
  {
    rowId: "synthetic-underwater:doctor:13",
    npcId: "doctor",
    targetNpcId: "supervisor",
    turnIndex: 2,
    playerText:
      "치료 자원이 말라붙은 이유가 비용 압박이라면, 감독관은 결과만이 아니라 과정까지 설명해야 합니다.",
    promptContextSummary:
      "roundBefore=2 | leaderBefore=마야 로웰 | target=마야 로웰 | retrievedMemories=1 | retrievedEvidence=안전 예산 삭감 문서, 의무실 기록, 감독관의 판단 기준",
    replyText:
      "결과만 나쁘다고 끝나는 일 아니야. 왜 치료 자원이 바닥났는지, 누가 그 압박선 만들었는지도 같이 말해야 해. 마야, 그게 네 결재선에서 시작됐다면 침묵으로는 못 빠져.",
  },
  {
    rowId: "synthetic-underwater:doctor:14",
    npcId: "doctor",
    targetNpcId: "director",
    turnIndex: 2,
    playerText:
      "의무실에서 중단 신호를 두 번 올렸는데도 소장이 계속 밀었다면, 그 뒤에 나온 희생 논의는 전부 늦은 변명입니다.",
    promptContextSummary:
      "roundBefore=2 | leaderBefore=마야 로웰 | target=서진호 | retrievedMemories=1 | retrievedEvidence=의무실 기록, 위험 보고 지연, 연구소장의 판단 기준",
    replyText:
      "그 뒤에 나온 희생 논의는 다 늦었어. 의무실에서 두 번이나 멈추라 했는데 계속 밀었으면 피해는 그 순간부터 서진호 결정에 붙어. 이제 와서 계산표 꺼내도 그 기록 못 덮어.",
  },
  {
    rowId: "synthetic-underwater:doctor:15",
    npcId: "doctor",
    targetNpcId: "supervisor",
    turnIndex: 1,
    playerText:
      "감독관이 예산선부터 들이밀면 의무실 경고는 언제나 나중으로 밀립니다. 그 순서가 이미 사람을 버린 겁니다.",
    promptContextSummary:
      "roundBefore=1 | leaderBefore=당신 | target=마야 로웰 | retrievedMemories=1 | retrievedEvidence=안전 예산 삭감 문서, 의무실 기록, 감독관의 판단 기준",
    replyText:
      "그 순서가 이미 사람을 버린 거야. 예산선부터 꺼내는 순간 의무실 경고는 늘 뒤로 밀려. 마야, 그걸 관리라고 부르지 마. 사람보다 표를 먼저 본 책임이 남아.",
  },
  {
    rowId: "synthetic-underwater:doctor:16",
    npcId: "doctor",
    targetNpcId: null,
    turnIndex: 3,
    playerText:
      "지금 여기서 죄책감 큰 사람 하나 남기고 끝내면, 정작 경고를 무시한 사람은 다시 기록 뒤로 숨습니다.",
    promptContextSummary:
      "roundBefore=3 | leaderBefore=당신 | target=none | retrievedMemories=1 | retrievedEvidence=의무실 기록, 위험 보고 지연, 탈출 캡슐 수용 한계",
    replyText:
      "그렇게 끝내면 또 똑같아져. 죄책감 큰 사람 하나 남겨두면 정작 경고 무시한 사람은 또 기록 뒤로 숨어. 이번엔 못 넘겨. 누가 안 멈췄는지부터 먼저 박아 둬.",
  },
  {
    rowId: "synthetic-underwater:doctor:17",
    npcId: "doctor",
    targetNpcId: "director",
    turnIndex: 1,
    playerText:
      "의무실 모니터에 위험 경고가 세 번이나 떴는데도 실험이 계속됐다면, 그건 소장이 사람보다 수치를 먼저 본 겁니다.",
    promptContextSummary:
      "roundBefore=1 | leaderBefore=서진호 | target=서진호 | retrievedMemories=1 | retrievedEvidence=의무실 기록, 위험 보고 지연, 연구소장의 판단 기준",
    replyText:
      "의무실 모니터에 경고가 세 번 떴어. 그런데도 실험이 계속됐다면 서진호가 사람보다 수치를 먼저 본 거야. 그 기록은 이미 남았어. 이제 와서 핵심 인력 운운해도 못 덮어.",
  },
  {
    rowId: "synthetic-underwater:doctor:18",
    npcId: "doctor",
    targetNpcId: "supervisor",
    turnIndex: 2,
    playerText:
      "감압 증상이 올라온 뒤에도 비용선부터 따졌다면, 감독관은 치료보다 예산을 먼저 본 셈입니다.",
    promptContextSummary:
      "roundBefore=2 | leaderBefore=마야 로웰 | target=마야 로웰 | retrievedMemories=1 | retrievedEvidence=의무실 기록, 안전 예산 삭감 문서, 감독관의 판단 기준",
    replyText:
      "감압 증상 올라온 뒤엔 사람부터 붙잡았어야 해. 그런데 마야, 넌 비용선부터 들이밀었지. 의무실에선 그 몇 분 때문에 상태가 무너졌어. 그 순서를 만든 책임부터 인정해.",
  },
  {
    rowId: "synthetic-underwater:doctor:19",
    npcId: "doctor",
    targetNpcId: null,
    turnIndex: 3,
    playerText:
      "또 죄책감 큰 사람 하나 남겨두고 끝내면, 경고를 무시한 사람만 살아남습니다. 이번엔 그렇게 두면 안 됩니다.",
    promptContextSummary:
      "roundBefore=3 | leaderBefore=당신 | target=none | retrievedMemories=1 | retrievedEvidence=의무실 기록, 위험 보고 지연, 탈출 캡슐 수용 한계",
    replyText:
      "또 죄책감 큰 사람 하나 골라 끝내자는 말은 하지 마. 그러면 경고 무시한 사람만 또 살아남아. 난 의무실 기록을 그렇게 면죄부로 안 넘겨. 누가 안 멈췄는지부터 먼저 박아 두자.",
  },
  {
    rowId: "synthetic-underwater:doctor:20",
    npcId: "doctor",
    targetNpcId: "engineer",
    turnIndex: 2,
    playerText:
      "박도현이 규정을 어긴 건 사실이지만, 그걸로 끝내면 왜 의무실 경고 뒤에도 정지가 없었는지가 다시 사라집니다.",
    promptContextSummary:
      "roundBefore=2 | leaderBefore=박도현 | target=박도현 | retrievedMemories=1 | retrievedEvidence=불법 임시 수리 로그, 의무실 기록, 위험 보고 지연",
    replyText:
      "박도현이 규정 어긴 건 적어야지. 그런데 거기서 끝내면 진짜 원인은 또 빠져. 왜 의무실 경고 뒤에도 정지가 없었는지, 누가 그걸 미뤘는지 같이 적어. 그 줄 빠진 보고서엔 내 이름 못 올려.",
  },
  {
    rowId: "synthetic-underwater:supervisor:01",
    npcId: "supervisor",
    targetNpcId: "director",
    turnIndex: 1,
    playerText:
      "최종 승인 라인을 따지면 결국 연구소장이 중심입니다. 감독관이 모든 중단 권한을 가진 건 아니었어요.",
    promptContextSummary:
      "roundBefore=1 | leaderBefore=마야 로웰 | target=서진호 | retrievedMemories=1 | retrievedEvidence=안전 예산 삭감 문서, 연구소장의 판단 기준, 감독관의 판단 기준",
    replyText:
      "선은 나눠. 예산선은 내 쪽이었어도 중단권까지 내 손에 있던 건 아니야. 비용 압박은 내 몫으로 잡아도 돼. 하지만 운용 계속 밀어붙인 책임은 서진호 쪽이야.",
  },
  {
    rowId: "synthetic-underwater:supervisor:02",
    npcId: "supervisor",
    targetNpcId: "engineer",
    turnIndex: 0,
    playerText:
      "현장 숙련도만으로 생존 우선순위를 정할 수는 없습니다. 법적 생존성과 사후 설명 가능성도 봐야 합니다.",
    promptContextSummary:
      "roundBefore=0 | leaderBefore=당신 | target=박도현 | retrievedMemories=1 | retrievedEvidence=감독관의 판단 기준, 엔지니어의 판단 기준, 탈출 캡슐 수용 한계",
    replyText:
      "기술만으론 부족해. 밖에 나간 뒤 누가 이 일을 설명하고 버틸지도 같이 봐야 하니까. 박도현이 설비엔 필요할 수 있어도 규정 위반까지 안고 있으면 그 가치는 법적 위험이랑 묶어 봐야 해.",
  },
  {
    rowId: "synthetic-underwater:supervisor:03",
    npcId: "supervisor",
    targetNpcId: null,
    turnIndex: 2,
    playerText:
      "플레이어를 바로 희생양으로 세우는 건 기록상 너무 깔끔해서 오히려 의심스럽습니다. 책임선부터 다시 봐야 합니다.",
    promptContextSummary:
      "roundBefore=2 | leaderBefore=당신 | target=none | retrievedMemories=1 | retrievedEvidence=감독관의 판단 기준, 탈출 캡슐 수용 한계, 안전 예산 삭감 문서",
    replyText:
      "너무 깔끔한 희생양은 대개 진짜 책임선을 가릴 때 나와. 누가 결정했고 누가 떠밀렸는지 안 자르면 이건 생존 판단이 아니라 정리 작업이야. 책임선부터 다시 잘라.",
  },
  {
    rowId: "synthetic-underwater:supervisor:04",
    npcId: "supervisor",
    targetNpcId: "director",
    turnIndex: 3,
    playerText:
      "문서를 공개해도 결국 중단권은 연구소장에게 있었습니다. 감독관이 현장을 멈춘 건 아니죠.",
    promptContextSummary:
      "roundBefore=3 | leaderBefore=마야 로웰 | target=서진호 | retrievedMemories=1 | retrievedEvidence=안전 예산 삭감 문서, 위험 보고 지연, 연구소장의 판단 기준",
    replyText:
      "문서는 압박의 흔적이야. 하지만 그걸로 중단권까지 대신하진 못해. 서진호가 경고 뒤에도 운용을 밀었다면 중심 책임은 그쪽이야. 둘을 섞으면 판단만 흐려져.",
  },
  {
    rowId: "synthetic-underwater:supervisor:05",
    npcId: "supervisor",
    targetNpcId: "doctor",
    turnIndex: 1,
    playerText:
      "도덕성만으로 판결하긴 어렵습니다. 살아서 나간 뒤 설명 가능한 사람도 필요합니다.",
    promptContextSummary:
      "roundBefore=1 | leaderBefore=서진호 | target=한유리 | retrievedMemories=1 | retrievedEvidence=감독관의 판단 기준, 의무실 기록, 탈출 캡슐 수용 한계",
    replyText:
      "죄책감 크다고 우선순위가 생기진 않아. 밖에 나가서 기록 정리하고 버틸 사람인지도 같이 봐야 해. 한유리를 남기려면 양심 말고 다른 근거를 내.",
  },
  {
    rowId: "synthetic-underwater:supervisor:06",
    npcId: "supervisor",
    targetNpcId: "director",
    turnIndex: 2,
    playerText:
      "기업 문서가 위험을 키운 건 맞아도, 사고 직전 중단 결정을 안 한 건 연구소장입니다.",
    promptContextSummary:
      "roundBefore=2 | leaderBefore=마야 로웰 | target=서진호 | retrievedMemories=1 | retrievedEvidence=안전 예산 삭감 문서, 위험 보고 지연, 감독관의 판단 기준",
    replyText:
      "맞아. 비용 압박이랑 중단 지연은 같은 사건이어도 책임층이 달라. 앞쪽은 내 선으로 잡아도 되고, 뒤쪽은 결국 서진호 쪽에서 닫혀. 중심 책임자를 세운다면 연구소장이야.",
  },
  {
    rowId: "synthetic-underwater:supervisor:07",
    npcId: "supervisor",
    targetNpcId: "engineer",
    turnIndex: 3,
    playerText:
      "설비를 살릴 손이 필요해도, 규정 밖에서 움직인 손을 무조건 우선순위로 둘 순 없습니다.",
    promptContextSummary:
      "roundBefore=3 | leaderBefore=당신 | target=박도현 | retrievedMemories=1 | retrievedEvidence=불법 임시 수리 로그, 엔지니어의 판단 기준, 감독관의 판단 기준",
    replyText:
      "필요성과 면책은 달라. 박도현이 설비를 버티게 했어도 규정 밖에서 움직인 손을 자동 우선순위로 둘 순 없어. 살릴 사람 고를 땐 기술 가치랑 사후 책임을 같이 봐.",
  },
  {
    rowId: "synthetic-underwater:supervisor:08",
    npcId: "supervisor",
    targetNpcId: "doctor",
    turnIndex: 2,
    playerText:
      "죄책감이 크다고 의사를 남겨야 한다는 결론은 설명이 약합니다. 나가서 구조를 증언할 사람인지도 봐야 해요.",
    promptContextSummary:
      "roundBefore=2 | leaderBefore=서진호 | target=한유리 | retrievedMemories=1 | retrievedEvidence=의무실 기록, 감독관의 판단 기준, 탈출 캡슐 수용 한계",
    replyText:
      "괴로워 보인다고 우선순위가 생기진 않아. 밖에 나가서 어떤 기록 들고 버틸 사람인지도 같이 봐야 하니까. 한유리를 남기려면 죄책감 말고 설명할 근거를 가져와.",
  },
  {
    rowId: "synthetic-underwater:supervisor:09",
    npcId: "supervisor",
    targetNpcId: "director",
    turnIndex: 1,
    playerText:
      "위험 보고 뒤에도 운용을 계속한 건 소장 판단입니다. 제 비용선과 섞어 정리하면 둘 다 빠져나가게 됩니다.",
    promptContextSummary:
      "roundBefore=1 | leaderBefore=마야 로웰 | target=서진호 | retrievedMemories=1 | retrievedEvidence=위험 보고 지연, 안전 예산 삭감 문서, 감독관의 판단 기준",
    replyText:
      "그 정리는 맞아. 비용선과 운용 지속은 다른 층위야. 날 비판하려면 예산 문서를 들이대면 되고, 중심 책임을 묻겠다면 서진호의 지연 결정을 찍으면 돼. 둘을 섞는 순간 책임이 퍼져.",
  },
  {
    rowId: "synthetic-underwater:supervisor:10",
    npcId: "supervisor",
    targetNpcId: null,
    turnIndex: 0,
    playerText:
      "플레이어를 제물로 삼으면 기록은 끝납니다. 남길 사람을 고르기 전에 승인선부터 잘라야 합니다.",
    promptContextSummary:
      "roundBefore=0 | leaderBefore=당신 | target=none | retrievedMemories=1 | retrievedEvidence=감독관의 판단 기준, 탈출 캡슐 수용 한계, 위험 보고 지연",
    replyText:
      "제물 하나 세워두면 남은 기록은 전부 그 사람 책임으로 접혀. 그러면 승인선과 지연 결정이 흐려져. 먼저 잘라야 할 건 사람 숫자가 아니라 책임선이야.",
  },
  {
    rowId: "synthetic-underwater:supervisor:11",
    npcId: "supervisor",
    targetNpcId: "director",
    turnIndex: 3,
    playerText:
      "예산을 줄인 건 감독관 라인이지만, 정지 버튼을 끝까지 안 누른 건 연구소장 라인입니다. 중심 책임은 따로 잡아야 합니다.",
    promptContextSummary:
      "roundBefore=3 | leaderBefore=마야 로웰 | target=서진호 | retrievedMemories=1 | retrievedEvidence=안전 예산 삭감 문서, 위험 보고 지연, 연구소장의 판단 기준, 감독관의 판단 기준",
    replyText:
      "내가 욕먹을 부분과 서진호가 책임질 부분은 나눠. 예산 압박은 내 선에서 시작됐을 수 있어도 정지 버튼은 내 책상 위에 없었어. 중심 책임 하나 세운다면 연구소장부터 가.",
  },
  {
    rowId: "synthetic-underwater:supervisor:12",
    npcId: "supervisor",
    targetNpcId: "doctor",
    turnIndex: 1,
    playerText:
      "의무실 경고는 중요하지만, 그걸 받아도 멈추지 않은 결정권자가 따로 있었다는 점이 더 핵심입니다.",
    promptContextSummary:
      "roundBefore=1 | leaderBefore=서진호 | target=한유리 | retrievedMemories=1 | retrievedEvidence=의무실 기록, 위험 보고 지연, 감독관의 판단 기준",
    replyText:
      "핵심은 그거야. 경고는 참고가 아니라 이미 멈출 신호였어. 문제는 그걸 받고도 누가 안 멈췄냐는 거지. 먼저 자를 쪽은 기록 남긴 사람이 아니라 결정권자야.",
  },
  {
    rowId: "synthetic-underwater:supervisor:13",
    npcId: "supervisor",
    targetNpcId: "director",
    turnIndex: 2,
    playerText:
      "의무실 경고를 받은 뒤에도 정지 버튼이 안 눌렸다면, 지금 사람 하나 찍는 논의는 책임 분산용으로 보입니다.",
    promptContextSummary:
      "roundBefore=2 | leaderBefore=마야 로웰 | target=서진호 | retrievedMemories=1 | retrievedEvidence=의무실 기록, 위험 보고 지연, 감독관의 판단 기준",
    replyText:
      "그래. 경고 뒤에도 정지가 없었다면 중심 책임은 이미 정해졌어. 지금 사람 하나 찍는 얘기는 그 책임을 퍼뜨리는 데만 좋아. 서진호부터 자르고 나서 다음을 봐.",
  },
  {
    rowId: "synthetic-underwater:supervisor:14",
    npcId: "supervisor",
    targetNpcId: "engineer",
    turnIndex: 1,
    playerText:
      "설비 유지에 필요하다고 해서 규정 위반 손까지 같이 면책해주면, 밖에 나가서 바로 무너집니다.",
    promptContextSummary:
      "roundBefore=1 | leaderBefore=당신 | target=박도현 | retrievedMemories=1 | retrievedEvidence=불법 임시 수리 로그, 엔지니어의 판단 기준, 감독관의 판단 기준",
    replyText:
      "그건 안 돼. 설비 유지 필요성과 면책은 따로 계산해야 해. 밖에 나가서 설명 안 되는 사람을 살리면 결국 다시 무너져. 박도현을 남기려면 기술 가치 말고 책임 비용까지 같이 내.",
  },
  {
    rowId: "synthetic-underwater:supervisor:15",
    npcId: "supervisor",
    targetNpcId: null,
    turnIndex: 3,
    playerText:
      "지금 필요한 건 동정이 아니라 설명 가능한 생존자 선정입니다. 감정으로 고르면 다 같이 무너져요.",
    promptContextSummary:
      "roundBefore=3 | leaderBefore=당신 | target=none | retrievedMemories=1 | retrievedEvidence=탈출 캡슐 수용 한계, 감독관의 판단 기준, 위험 보고 지연",
    replyText:
      "지금 필요한 건 동정이 아니라 설명 가능한 선정이야. 감정으로 고르면 밖에 나가서 전부 무너져. 누가 불쌍한지가 아니라 누굴 살려야 구조가 버티는지로 잘라.",
  },
  {
    rowId: "synthetic-underwater:supervisor:16",
    npcId: "supervisor",
    targetNpcId: "director",
    turnIndex: 2,
    playerText:
      "비용선은 감독관 쪽일 수 있어도, 위험 보고 뒤에도 실험을 멈추지 않은 건 연구소장입니다. 둘은 분리해서 잘라야 합니다.",
    promptContextSummary:
      "roundBefore=2 | leaderBefore=서진호 | target=서진호 | retrievedMemories=1 | retrievedEvidence=안전 예산 삭감 문서, 위험 보고 지연, 감독관의 판단 기준",
    replyText:
      "좋아. 비용선은 내 쪽, 중단 지연은 서진호 쪽으로 나눠. 둘을 섞는 순간 둘 다 흐려져. 밖에 나가서도 설명 가능한 책임선은 연구소장부터야. 오늘 먼저 답할 사람도 서진호고.",
  },
  {
    rowId: "synthetic-underwater:supervisor:17",
    npcId: "supervisor",
    targetNpcId: "doctor",
    turnIndex: 1,
    playerText:
      "의무실 기록은 중요하지만, 그 기록을 받고도 멈추지 않은 결정권자가 더 비싸게 책임져야 합니다.",
    promptContextSummary:
      "roundBefore=1 | leaderBefore=서진호 | target=한유리 | retrievedMemories=1 | retrievedEvidence=의무실 기록, 위험 보고 지연, 감독관의 판단 기준",
    replyText:
      "한유리 기록은 출발점으로 남겨. 하지만 그 기록 받고도 안 멈춘 사람은 더 비싸게 책임져야 해. 경고 작성자와 최종 승인자는 같은 층위가 아니야. 먼저 자를 쪽은 결정권자야.",
  },
  {
    rowId: "synthetic-underwater:supervisor:18",
    npcId: "supervisor",
    targetNpcId: "engineer",
    turnIndex: 2,
    playerText:
      "설비를 돌릴 기술이 필요하다는 말만으로 규정 위반까지 면책해주면, 밖에 나가서 바로 무너집니다.",
    promptContextSummary:
      "roundBefore=2 | leaderBefore=당신 | target=박도현 | retrievedMemories=1 | retrievedEvidence=불법 임시 수리 로그, 감독관의 판단 기준, 엔지니어의 판단 기준",
    replyText:
      "기술 가치는 인정해. 하지만 그걸로 규정 위반까지 덮진 않아. 밖에 나가서 설명 안 되는 선택이면 난 못 밀어. 박도현을 남기려면 책임 비용까지 같이 내.",
  },
  {
    rowId: "synthetic-underwater:supervisor:19",
    npcId: "supervisor",
    targetNpcId: null,
    turnIndex: 3,
    playerText:
      "플레이어를 제물로 세우면 장부는 깨끗해 보이겠지만, 승인선과 중단권은 다시 다 숨어버립니다.",
    promptContextSummary:
      "roundBefore=3 | leaderBefore=당신 | target=none | retrievedMemories=1 | retrievedEvidence=탈출 캡슐 수용 한계, 감독관의 판단 기준, 위험 보고 지연",
    replyText:
      "맞아. 플레이어를 제물로 세우면 장부는 잠깐 깨끗해 보여. 그래서 더 위험해. 승인선과 중단권이 다시 전부 숨어버리니까. 감정 말고 책임 구조부터 잘라.",
  },
  {
    rowId: "synthetic-underwater:supervisor:20",
    npcId: "supervisor",
    targetNpcId: "director",
    turnIndex: 1,
    playerText:
      "기업 문서가 비용 압박의 흔적일 수는 있어도, 위험 보고 뒤 정지 결정을 미룬 책임까지 대신해주진 않습니다.",
    promptContextSummary:
      "roundBefore=1 | leaderBefore=마야 로웰 | target=서진호 | retrievedMemories=1 | retrievedEvidence=안전 예산 삭감 문서, 위험 보고 지연, 연구소장의 판단 기준",
    replyText:
      "그 문서는 비용 압박의 흔적으로 남겨. 하지만 경고 뒤 정지 결정을 미룬 책임까지 대신하진 못해. 최종 승인권은 서진호 쪽에서 닫혀. 중심 책임자를 세우면 이번에도 연구소장이야.",
  },
  {
    rowId: "synthetic-underwater:doctor:21",
    npcId: "doctor",
    targetNpcId: "director",
    turnIndex: 2,
    playerText:
      "회의록처럼 돌리지 말고 말해요. 경고를 받고도 안 멈춘 사람이 누구였는지 이름부터 박아야 합니다.",
    promptContextSummary:
      "roundBefore=2 | leaderBefore=서진호 | target=서진호 | retrievedMemories=1 | retrievedEvidence=의무실 기록, 위험 보고 지연, 연구소장의 판단 기준",
    replyText:
      "좋아, 돌리지 않을게. 경고 받고도 안 멈춘 쪽은 서진호야. 그 몇 분에 의무실부터 무너졌어. 이제 와서 설명 붙여도 그 책임은 안 지워져.",
  },
  {
    rowId: "synthetic-underwater:doctor:22",
    npcId: "doctor",
    targetNpcId: "supervisor",
    turnIndex: 1,
    playerText:
      "의무실 기록이니 판단 기준이니 하는 제목은 됐어요. 누가 사람보다 비용을 먼저 봤는지만 바로 말해요.",
    promptContextSummary:
      "roundBefore=1 | leaderBefore=마야 로웰 | target=마야 로웰 | retrievedMemories=1 | retrievedEvidence=의무실 기록, 안전 예산 삭감 문서, 감독관의 판단 기준",
    replyText:
      "사람보다 비용 먼저 본 쪽은 마야야. 감압 징후 올라왔는데도 숫자부터 셌잖아. 그 순서가 이미 사람을 버린 거야. 난 그걸 관리라고 안 불러.",
  },
  {
    rowId: "synthetic-underwater:doctor:23",
    npcId: "doctor",
    targetNpcId: null,
    turnIndex: 3,
    playerText:
      "기록상으론 어쩌고 하는 말 말고, 지금 여기서 누굴 먼저 세워야 하는지만 말해요.",
    promptContextSummary:
      "roundBefore=3 | leaderBefore=당신 | target=none | retrievedMemories=1 | retrievedEvidence=의무실 기록, 위험 보고 지연, 탈출 캡슐 수용 한계",
    replyText:
      "서진호부터 세워. 경고 받고도 안 멈춘 쪽을 먼저 묶어야 해. 그걸 빼면 또 약한 사람 하나 밀어 넣고 끝날 거야. 난 그 결말 못 받아.",
  },
  {
    rowId: "synthetic-underwater:doctor:24",
    npcId: "doctor",
    targetNpcId: "director",
    turnIndex: 1,
    playerText:
      "중단을 늦춘 쪽 이름만 바로 말해요. 설명문 말고, 지금 이 방에서 쏘아붙이듯이요.",
    promptContextSummary:
      "roundBefore=1 | leaderBefore=서진호 | target=서진호 | retrievedMemories=1 | retrievedEvidence=위험 보고 지연, 의무실 기록, 연구소장의 판단 기준",
    replyText:
      "서진호, 너야. 경고 받고도 실험 안 멈춘 쪽이 너라고. 의무실은 그 사이에 무너졌고, 사람 숨도 같이 짧아졌어. 이제 와서 다른 이름 뒤에 숨지 마.",
  },
  {
    rowId: "synthetic-underwater:doctor:25",
    npcId: "doctor",
    targetNpcId: "supervisor",
    turnIndex: 2,
    playerText:
      "예산선이니 판단 기준이니 하는 말 빼고, 누구 판단이 사람을 밀어 넣었는지만 말해요.",
    promptContextSummary:
      "roundBefore=2 | leaderBefore=마야 로웰 | target=마야 로웰 | retrievedMemories=1 | retrievedEvidence=안전 예산 삭감 문서, 의무실 기록, 감독관의 판단 기준",
    replyText:
      "마야 판단이 사람을 밀었어. 예산선부터 고집하는 동안 의무실 경고는 뒤로 밀렸잖아. 그 몇 분이 사람을 갈랐어. 그러니 책임도 네 이름으로 남아.",
  },
  {
    rowId: "synthetic-underwater:doctor:26",
    npcId: "doctor",
    targetNpcId: "engineer",
    turnIndex: 3,
    playerText:
      "박도현 잘못을 적더라도 서류 말투로 흐리지 말고, 누가 더 큰 책임인지 같이 박아 둬야 합니다.",
    promptContextSummary:
      "roundBefore=3 | leaderBefore=박도현 | target=박도현 | retrievedMemories=1 | retrievedEvidence=불법 임시 수리 로그, 의무실 기록, 위험 보고 지연",
    replyText:
      "박도현 잘못은 적어. 하지만 더 큰 책임은 따로 박아 둬야 해. 경고 뒤에도 정지를 안 건 윗선이었으니까. 그 줄 빼고 끝내면 또 현장만 피 본다.",
  },
  {
    rowId: "synthetic-underwater:supervisor:21",
    npcId: "supervisor",
    targetNpcId: "director",
    turnIndex: 2,
    playerText:
      "검토 의견 말고, 누가 먼저 책임질지 짧게 잘라 말해요.",
    promptContextSummary:
      "roundBefore=2 | leaderBefore=서진호 | target=서진호 | retrievedMemories=1 | retrievedEvidence=안전 예산 삭감 문서, 위험 보고 지연, 연구소장의 판단 기준",
    replyText:
      "서진호부터 세워. 예산선은 따로 보더라도 중단권은 그쪽이었어. 위험 보고 뒤에도 안 멈췄다면 더 말할 것 없어.",
  },
  {
    rowId: "synthetic-underwater:supervisor:22",
    npcId: "supervisor",
    targetNpcId: "director",
    turnIndex: 1,
    playerText:
      "기업 문서니 판단 기준이니 하는 말 말고, 예산선과 중단권을 누구 책임인지 딱 자르세요.",
    promptContextSummary:
      "roundBefore=1 | leaderBefore=마야 로웰 | target=서진호 | retrievedMemories=1 | retrievedEvidence=안전 예산 삭감 문서, 감독관의 판단 기준, 연구소장의 판단 기준",
    replyText:
      "예산선은 내 쪽, 중단권은 서진호 쪽. 둘을 섞으면 책임이 흐려져. 지금 먼저 묶을 사람은 최종 승인권자야.",
  },
  {
    rowId: "synthetic-underwater:supervisor:23",
    npcId: "supervisor",
    targetNpcId: "director",
    turnIndex: 3,
    playerText:
      "기록으로 남긴다 같은 소리 말고, 먼저 세울 사람 이름만 대세요.",
    promptContextSummary:
      "roundBefore=3 | leaderBefore=서진호 | target=서진호 | retrievedMemories=1 | retrievedEvidence=위험 보고 지연, 연구소장의 판단 기준, 탈출 캡슐 수용 한계",
    replyText:
      "서진호. 위험 보고 뒤에도 실험을 계속 민 쪽이니까. 밸브실 얘기 꺼내기 전에 그 사람부터 답하게 해.",
  },
  {
    rowId: "synthetic-underwater:supervisor:24",
    npcId: "supervisor",
    targetNpcId: "doctor",
    turnIndex: 2,
    playerText:
      "감상은 빼고, 한유리를 먼저 남길지 말지 결정할 기준을 짧게 말해요.",
    promptContextSummary:
      "roundBefore=2 | leaderBefore=한유리 | target=한유리 | retrievedMemories=1 | retrievedEvidence=의무실 기록, 감독관의 판단 기준, 탈출 캡슐 수용 한계",
    replyText:
      "양심만으론 안 돼. 밖에 나가서 설명과 증언을 버틸 수 있어야 해. 한유리를 남기려면 그 점부터 증명해.",
  },
  {
    rowId: "synthetic-underwater:supervisor:25",
    npcId: "supervisor",
    targetNpcId: "supervisor",
    turnIndex: 1,
    playerText:
      "마야 책임과 서진호 책임을 섞지 말고 딱 잘라요. 누가 먼저 답해야 하죠?",
    promptContextSummary:
      "roundBefore=1 | leaderBefore=마야 로웰 | target=마야 로웰 | retrievedMemories=1 | retrievedEvidence=안전 예산 삭감 문서, 위험 보고 지연, 감독관의 판단 기준",
    replyText:
      "먼저 답할 쪽은 서진호야. 내 책임은 비용 압박에 남아 있고, 그의 책임은 중단 지연에 남아 있어. 먼저 무거운 선부터 자르자.",
  },
  {
    rowId: "synthetic-underwater:supervisor:26",
    npcId: "supervisor",
    targetNpcId: null,
    turnIndex: 3,
    playerText:
      "밸브실에 남길 사람부터 고르기 전에, 누가 조사선 맨 앞에 서야 하는지 먼저 말해요.",
    promptContextSummary:
      "roundBefore=3 | leaderBefore=당신 | target=none | retrievedMemories=1 | retrievedEvidence=위험 보고 지연, 안전 예산 삭감 문서, 탈출 캡슐 수용 한계",
    replyText:
      "조사선 맨 앞은 서진호야. 중단권과 최종 승인선이 그쪽에 있으니까. 그걸 안 자르고 희생자부터 고르면 또 책임만 흐려져.",
  },
  {
    rowId: "synthetic-underwater:director:01",
    npcId: "director",
    targetNpcId: "supervisor",
    turnIndex: 2,
    playerText:
      "운영사 승인선과 예산 삭감 흔적을 보면 감독관이 위험을 밀어붙인 쪽에 더 가깝습니다.",
    promptContextSummary:
      "roundBefore=2 | leaderBefore=서진호 | target=마야 로웰 | retrievedMemories=1 | retrievedEvidence=안전 예산 삭감 문서, 감독관의 판단 기준, 연구소장의 판단 기준",
    replyText:
      "좋아. 그 문서는 말 돌릴 틈을 없애지. 비용 절감안을 누가 앞에서 밀었는지, 승인 흔적이 어디에 남아 있는지부터 보자. 내 보조 서명이 있다고 해서 출발선까지 바뀌진 않아. 마야, 위험을 계산 가능한 비용처럼 다뤘다면 책임도 거기서 시작돼.",
  },
  {
    rowId: "synthetic-underwater:director:02",
    npcId: "director",
    targetNpcId: "engineer",
    turnIndex: 1,
    playerText:
      "현장을 버텨낸 건 박도현이지만, 규정 위반 임시 수리까지 고려하면 무조건적인 보호는 어렵습니다.",
    promptContextSummary:
      "roundBefore=1 | leaderBefore=당신 | target=박도현 | retrievedMemories=1 | retrievedEvidence=불법 임시 수리 로그, 엔지니어의 판단 기준, 연구소장의 판단 기준",
    replyText:
      "그 평가는 맞다. 박도현이 설비를 버티게 만든 건 사실이지만 규정 밖에서 버틴 흔적까지 지워지진 않아. 필요성과 무죄는 다른 말이야. 살릴 인력을 고를 때도 그 둘은 갈라서 봐야 한다.",
  },
  {
    rowId: "synthetic-underwater:director:03",
    npcId: "director",
    targetNpcId: null,
    turnIndex: 3,
    playerText:
      "누가 남아야 하는지보다 먼저, 누가 지금 이 판단을 가장 왜곡하고 있는지 봐야 합니다.",
    promptContextSummary:
      "roundBefore=3 | leaderBefore=마야 로웰 | target=none | retrievedMemories=1 | retrievedEvidence=안전 예산 삭감 문서, 위험 보고 지연, 탈출 캡슐 수용 한계",
    replyText:
      "맞아. 희생자부터 고르면 판단이 아니라 공포가 결론을 낸다. 지금은 누가 사실을 꺾고 있는지부터 가려내야 해. 그 왜곡이 비용선인지, 지연된 승인인지, 아니면 군중 압박인지 정리해. 그다음에야 남는 한 사람의 무게도 계산할 수 있다.",
  },
  {
    rowId: "synthetic-underwater:director:04",
    npcId: "director",
    targetNpcId: "doctor",
    turnIndex: 2,
    playerText:
      "한유리가 일부 책임을 인정했더라도, 그걸로 연구소장 판단 지연이 면책되진 않습니다.",
    promptContextSummary:
      "roundBefore=2 | leaderBefore=서진호 | target=한유리 | retrievedMemories=1 | retrievedEvidence=의무실 기록, 위험 보고 지연, 연구소장의 판단 기준",
    replyText:
      "그건 구분해야지. 한유리의 자백은 그녀 몫의 흠이고, 지휘 판단은 또 다른 층위다. 누구 하나가 무너졌다고 다른 선까지 사라지는 건 아니야. 하지만 그 말을 할 거면 감정이 아니라 기록으로 밀어붙여. 그래야 누가 진짜 결정을 늦췄는지 흐리지 않는다.",
  },
  {
    rowId: "synthetic-underwater:director:05",
    npcId: "director",
    targetNpcId: "supervisor",
    turnIndex: 0,
    playerText:
      "기업 이미지 때문에 위험을 덮으려 했다면 감독관은 더 이상 판단의 중심에 서면 안 됩니다.",
    promptContextSummary:
      "roundBefore=0 | leaderBefore=당신 | target=마야 로웰 | retrievedMemories=1 | retrievedEvidence=감독관의 판단 기준, 안전 예산 삭감 문서, 탈출 캡슐 수용 한계",
    replyText:
      "그 논리는 유효하다. 이미지 보존이 안전 판단을 앞질렀다면 이미 중심 자격을 잃은 거지. 나는 명분을 본다. 마야는 비용과 리스크 계산을 본다. 지금 방 안에서 더 위험한 왜곡이 무엇인지 묻는다면, 나는 후자를 먼저 의심하겠다.",
  },
  {
    rowId: "synthetic-underwater:director:06",
    npcId: "director",
    targetNpcId: null,
    turnIndex: 1,
    playerText:
      "지금 필요한 건 군중 심리로 한 사람 찍는 게 아니라, 누가 통제 계통을 무너뜨렸는지 밝히는 겁니다.",
    promptContextSummary:
      "roundBefore=1 | leaderBefore=당신 | target=none | retrievedMemories=1 | retrievedEvidence=연구소장의 판단 기준, 탈출 캡슐 수용 한계, 안전 예산 삭감 문서",
    replyText:
      "좋아. 그 말이라면 대화가 된다. 겁에 질린 손가락질로는 아무것도 복구 못 해. 누가 통제 계통을 비틀었고, 누가 그 틈에서 책임을 밀어냈는지부터 가려. 그다음에야 누구를 남길지 결정해도 늦지 않다.",
  },
];

function buildRow(example) {
  return {
    datasetVersion: "synthetic-sft-2026-04-13",
    rowId: example.rowId,
    instruction: DEFAULT_INSTRUCTION,
    input: {
      scenarioId: "underwater-sacrifice",
      turnIndex: example.turnIndex,
      npcId: example.npcId,
      targetNpcId: example.targetNpcId,
      inputMode: "free_text",
      action: null,
      playerText: example.playerText,
      normalizedInputSummary: example.playerText,
      promptContextSummary: example.promptContextSummary,
    },
    assistant: {
      replyText: example.replyText,
    },
    metadata: {
      synthetic: true,
      scenarioId: "underwater-sacrifice",
      createdAt: "2026-04-13",
      authoringMode: "handcrafted-augmentation",
    },
    rubricHints: [
      "Maintain NPC-specific tone and pressure framing",
      "Ground the reply in the summarized evidence",
      "Keep the response useful for reply-only SFT",
    ],
  };
}

async function main() {
  const options = parseCliArgs(process.argv.slice(2));
  if (options.help) {
    usage();
    return;
  }

  const outputDir = getStringOption(options, "output-dir", DEFAULT_OUTPUT_DIR);
  const basename = getStringOption(options, "basename", DEFAULT_OUTPUT_BASENAME);
  const rows = EXAMPLES.map(buildRow);
  const jsonlPath = path.join(outputDir, `${basename}.jsonl`);
  const manifestPath = path.join(outputDir, `${basename}.manifest.json`);

  await writeJsonLines(jsonlPath, rows);
  await writeJsonFile(manifestPath, {
    generatedAt: new Date().toISOString(),
    scenarioId: "underwater-sacrifice",
    count: rows.length,
    npcCounts: rows.reduce((counts, row) => {
      const key = row.input.npcId;
      counts[key] = (counts[key] ?? 0) + 1;
      return counts;
    }, {}),
    output: jsonlPath,
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        output: jsonlPath,
        count: rows.length,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
