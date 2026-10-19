#!/usr/bin/env bash
# تشغيل «ميزان» بأمر واحد: يثبّت ويبني عند الحاجة ثم يقلع على منفذ واحد.
# مناسب للمشغّلات الخارجية: تطبيقات الأنفاق، خدمات النظام، الحاويات.
#
#   PORT=8080 ./start.sh
#   DATA_DIR=/var/lib/mizan ./start.sh     # لوضع قاعدة البيانات خارج المشروع

set -euo pipefail
cd "$(dirname "$0")"

if [ ! -d backend/node_modules ] || [ ! -f frontend/dist/index.html ]; then
  echo "… أول تشغيل: تثبيت الحزم وبناء الواجهة"
  npm run setup
fi

exec npm start
