#!/bin/bash
# ============================================================
#  ドメインを設定する
#  使い方：  bash set-domain.sh https://example.co.jp
#  ※ 末尾のスラッシュは付けないこと
# ============================================================

URL="$1"

if [ -z "$URL" ]; then
  echo "使い方: bash set-domain.sh https://example.co.jp"
  echo "  ※ 末尾のスラッシュは付けないでください"
  exit 1
fi

case "$URL" in
  https://*|http://*) ;;
  *) echo "エラー: https:// から始めてください（例 https://example.co.jp）"; exit 1 ;;
esac

case "$URL" in
  */) echo "エラー: 末尾のスラッシュは付けないでください"; exit 1 ;;
esac

echo "設定するドメイン: $URL"
echo ""

# 置換前の件数
BEFORE=$(grep -o '__SITE_URL__' *.html *.txt *.xml 2>/dev/null | wc -l)
echo "置換対象: ${BEFORE} か所"

# 控えを取る
STAMP=$(date +%Y%m%d-%H%M%S)
mkdir -p "backup-${STAMP}"
cp *.html *.txt *.xml "backup-${STAMP}/" 2>/dev/null
echo "控え: backup-${STAMP}/ に保存しました"

# 置換
sed -i "s|__SITE_URL__|${URL}|g" *.html *.txt *.xml 2>/dev/null

# 検算
AFTER=$(grep -o '__SITE_URL__' *.html *.txt *.xml 2>/dev/null | wc -l)
FILLED=$(grep -o "${URL}" *.html *.txt *.xml 2>/dev/null | wc -l)

echo ""
echo "---- 結果 ----"
echo "残り __SITE_URL__ : ${AFTER}  （0 なら成功）"
echo "埋まった件数      : ${FILLED}"
echo ""

if [ "$AFTER" -eq 0 ]; then
  echo "成功しました。"
  echo "確認: grep -o \"${URL}[^\\\"]*\" index.html | head -3"
else
  echo "置換しきれていません。backup-${STAMP}/ から戻せます。"
  echo "  cp backup-${STAMP}/*.html backup-${STAMP}/*.txt backup-${STAMP}/*.xml ."
fi
