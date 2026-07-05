#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

API_URL="${API_URL:-http://localhost:${GATEWAY_PORT:-8088}}"
API_KEY="${RAG_API_KEY:-${RAG_API_KEYS:-change-me-rag-api-key}}"
TMP_DOC="$(mktemp /tmp/mohkam-rag-arabic-XXXX.txt)"

cat > "$TMP_DOC" <<'DOC'
عقد خدمات

يلتزم مقدم الخدمة بتسليم التقرير النهائي خلال ثلاثين يوما من تاريخ توقيع العقد.
يلتزم العميل بسداد الدفعة الأولى خلال سبعة أيام عمل من استلام الفاتورة.
تخضع أي منازعة تنشأ عن هذا العقد للقوانين المعمول بها في المملكة الأردنية الهاشمية.
DOC

echo "Uploading Arabic sample document..."
UPLOAD_JSON="$(curl -fsS -X POST "$API_URL/v1/documents" \
  -H "X-API-Key: $API_KEY" \
  -F "tenant_id=default" \
  -F 'metadata={"case_id":"smoke-test","language":"ar"}' \
  -F "files=@${TMP_DOC};type=text/plain")"

JOB_ID="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["jobs"][0]["id"])' <<< "$UPLOAD_JSON")"
echo "Job: $JOB_ID"

for _ in $(seq 1 90); do
  JOB_JSON="$(curl -fsS "$API_URL/v1/jobs/$JOB_ID?tenant_id=default" -H "X-API-Key: $API_KEY")"
  STATUS="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["status"])' <<< "$JOB_JSON")"
  echo "Status: $STATUS"
  if [[ "$STATUS" == "succeeded" ]]; then
    break
  fi
  if [[ "$STATUS" == "failed" ]]; then
    echo "$JOB_JSON"
    exit 1
  fi
  sleep 5
done

echo "Querying..."
curl -fsS -X POST "$API_URL/v1/query" \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"tenant_id":"default","question":"ما مدة تسليم التقرير النهائي؟","top_k":12,"rerank_top_n":4}' \
  | python3 -m json.tool

rm -f "$TMP_DOC"
