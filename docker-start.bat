@echo off
REM Remove existing container if it exists to avoid naming conflicts
echo Cleaning up old container...
docker rm -f elevator-game 2>nul

REM Build the Docker image from the current directory
echo Building Docker Image...
docker build -t elevator-game .

REM Run the container in detached mode and map port 3000
echo Starting Docker Container...
docker run -d --name elevator-game -p 3000:3000 elevator-game

echo.
echo Started successfully! Please open your browser and go to http://localhost:3000
pause
