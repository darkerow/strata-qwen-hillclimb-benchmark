#!/bin/bash
set -euo pipefail
mkdir -p /home/ubuntu/strata-test
cd /home/ubuntu/strata-test
date -u +%FT%TZ > setup-start.txt
nvidia-smi > gpu-before.txt
lscpu > cpu.txt
free -h > ram.txt
df -h > disk.txt
sudo apt-get update -qq
sudo apt-get install -y -qq python3-venv git
git clone https://github.com/Niko1221/Strata.git Strata
cd Strata
git checkout 30ec18ec7094550fcc594fd948220d511d80464e
export PYTHONUNBUFFERED=1
exec ./setup.sh --yes --family qwen --model IQ2_XS --context 65536 --vision no --experimental-speed-projection off --host 127.0.0.1 --port 8080
