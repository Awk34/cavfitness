#!/bin/bash
set -e

if command -v pnpm &> /dev/null; then
  PM="pnpm"
else
  PM="npm"
fi

echo "command - $PM run build"
$PM run build

echo "command - $PM run smoke-test"
$PM run smoke-test

echo "command - aws ecr get-login-password --region <region> | docker login --username AWS --password-stdin <aws-account-id>.dkr.ecr.<region>.amazonaws.com"
aws ecr get-login-password --region <region> | docker login --username AWS --password-stdin <aws-account-id>.dkr.ecr.<region>.amazonaws.com

echo "command - docker build --platform linux/amd64 --progress=plain -t scraper ."
docker build --platform linux/amd64 --progress=plain -t scraper .

echo "command - container smoke test"
docker run --rm --entrypoint node scraper -e "const { VERSION } = require('./index.js'); if (!VERSION || VERSION === 'unknown') process.exit(1); console.log('Container smoke test passed. Version:', VERSION);"

echo "command - docker tag scraper:latest <aws-account-id>.dkr.ecr.<region>.amazonaws.com/scraper:latest"
docker tag scraper:latest <aws-account-id>.dkr.ecr.<region>.amazonaws.com/scraper:latest

echo "command - docker push <aws-account-id>.dkr.ecr.<region>.amazonaws.com/scraper:latest"
docker push <aws-account-id>.dkr.ecr.<region>.amazonaws.com/scraper:latest