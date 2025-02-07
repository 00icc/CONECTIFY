#!/bin/bash

# Store the PID file
PID_FILE="/tmp/ae-bridge-server.pid"

# Function to check if the server is running
is_server_running() {
  if [ -f "$PID_FILE" ]; then
    PID=$(cat "$PID_FILE")
    if ps -p "$PID" > /dev/null; then
      return 0
    fi
  fi
  return 1
}

# Function to cleanup on exit
cleanup() {
  if [ -f "$PID_FILE" ]; then
    PID=$(cat "$PID_FILE")
    if ps -p "$PID" > /dev/null; then
      kill "$PID"
    fi
    rm -f "$PID_FILE"
  fi
  exit 0
}

# Set up trap for cleanup
trap cleanup SIGINT SIGTERM

# Default ports
HTTP_PORT=${1:-3001}
WS_PORT=${2:-3002}

# Start the server if it is not running
if ! is_server_running; then
  echo "Starting AE Bridge Server (HTTP: $HTTP_PORT, WS: $WS_PORT)..."
  node cli/MCP/ae-bridge-server.js $HTTP_PORT $WS_PORT &
  SERVER_PID=$!
  echo "$SERVER_PID" > "$PID_FILE"
  echo "AE Bridge Server started with PID $SERVER_PID"
  
  # Wait a moment to check if the server started successfully
  sleep 2
  if ! is_server_running; then
    echo "Failed to start AE Bridge Server"
    exit 1
  fi
else
  echo "AE Bridge Server is already running."
fi

# Monitor the server and restart if it crashes
while true; do
  if ! is_server_running; then
    echo "AE Bridge Server crashed. Restarting (HTTP: $HTTP_PORT, WS: $WS_PORT)..."
    node cli/MCP/ae-bridge-server.js $HTTP_PORT $WS_PORT &
    SERVER_PID=$!
    echo "$SERVER_PID" > "$PID_FILE"
    echo "AE Bridge Server restarted with PID $SERVER_PID"
    
    # Wait to verify successful restart
    sleep 2
    if ! is_server_running; then
      echo "Failed to restart AE Bridge Server"
      cleanup
      exit 1
    fi
  fi
  sleep 5
done
