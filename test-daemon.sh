#!/bin/bash

# Test daemon that runs test-upload.mts every 90 seconds
# Handles graceful shutdown on SIGINT and SIGTERM

API_URL="${API_URL:-http://localhost:3000}"
INTERVAL=90

# Flag to control the main loop
RUNNING=true

# Signal handler for graceful shutdown
cleanup() {
    echo ""
    echo "👋 Shutting down daemon..."
    RUNNING=false
}

# Trap SIGINT (Ctrl+C) and SIGTERM
trap cleanup SIGINT SIGTERM

echo "🚀 Starting upload daemon..."
echo "📍 API URL: ${API_URL}"
echo "⏰ Upload interval: ${INTERVAL} seconds"
echo ""

upload_count=0

while [ "$RUNNING" = true ]; do
    upload_count=$((upload_count + 1))
    echo ""
    echo "📋 Upload #${upload_count} - $(date -Iseconds)"
    
    # Run test-upload.mts with the API_URL environment variable
    API_URL="$API_URL" npx tsx test-upload.mts
    
    # Check if we should exit before waiting
    if [ "$RUNNING" = false ]; then
        break
    fi
    
    echo "⏳ Waiting ${INTERVAL} seconds until next upload..."
    
    # Sleep in smaller intervals to allow for faster shutdown response
    for i in $(seq 1 $INTERVAL); do
        if [ "$RUNNING" = false ]; then
            break
        fi
        sleep 1
    done
done

echo "✅ Daemon stopped gracefully"