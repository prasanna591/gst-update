@echo off
cd /d "%~dp0"
if not exist "..\backups" mkdir "..\backups"
python backup.py >> "..\backups\backup_log.txt" 2>&1