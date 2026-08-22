#!/usr/bin/env bash
set -euo pipefail

base_url="${1:-https://kiwikiwi.wittyocean-59f7b48b.koreacentral.azurecontainerapps.io}"

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required" >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required" >&2
  exit 1
fi

cookie_file=$(mktemp "${TMPDIR:-/tmp}/kiwi-e2e.XXXXXX")
trap 'rm -f "$cookie_file"' EXIT

curl -fsS -c "$cookie_file" -H 'content-type: application/json' -d '{}' "$base_url/guest/session" >/dev/null

goal=$(curl -fsS -b "$cookie_file" -H 'content-type: application/json' -d '{"goalText":"해커톤 데모 안정화","currentState":"기능 점검 중","duration":"7일","constraints":["하루 20분"],"metric":"매일 1회 점검"}' "$base_url/goals")
goal_id=$(printf '%s' "$goal" | jq -r '.data.goalId')

plans=$(curl -fsS -b "$cookie_file" -X POST "$base_url/goals/$goal_id/plans:generate")
plan_id=$(printf '%s' "$plans" | jq -r '.data[0].planId')
plan_date=$(printf '%s' "$plans" | jq -r '.data[0].planDate')

if [[ -z "$plan_id" || "$plan_id" == "null" ]]; then
  echo "plan generation failed" >&2
  exit 1
fi

diary=$(curl -fsS -b "$cookie_file" -H 'content-type: application/json' -d "{\"date\":\"$plan_date\",\"content\":\"오늘은 계획을 70% 실행했고 시간 배분이 아쉬웠다\"}" "$base_url/goals/$goal_id/diaries")
diary_id=$(printf '%s' "$diary" | jq -r '.data.diaryId')

preview=$(curl -fsS -b "$cookie_file" -X POST "$base_url/diaries/$diary_id/next-day-plan-preview")
adjusted_day_index=$(printf '%s' "$preview" | jq -r '.data.adjustedDayIndex')
revised_task=$(printf '%s' "$preview" | jq -r '.data.revisedTask')
assistant_message=$(printf '%s' "$preview" | jq -r '.data.assistantMessage')

apply=$(curl -fsS -b "$cookie_file" -H 'content-type: application/json' -d "{\"adjustedDayIndex\":$adjusted_day_index,\"revisedTask\":\"$revised_task\",\"assistantMessage\":\"$assistant_message\"}" "$base_url/diaries/$diary_id/next-day-plan-apply")

chat=$(curl -fsS -b "$cookie_file" -H 'content-type: application/json' -d '{"message":"계획이 조금 부담돼"}' "$base_url/consultation/messages")
chat_reply=$(printf '%s' "$chat" | jq -r '.data.assistantMessage.content')

if [[ -z "$chat_reply" || "$chat_reply" == "null" ]]; then
  echo "chat reply is empty" >&2
  exit 1
fi

echo "SMOKE_OK"
echo "base_url=$base_url"
echo "goal_id=$goal_id"
echo "plan_id=$plan_id"
echo "preview_day=$adjusted_day_index"
echo "applied_task=$(printf '%s' "$apply" | jq -r '.data.revisedTask')"
echo "chat_reply=$chat_reply"
