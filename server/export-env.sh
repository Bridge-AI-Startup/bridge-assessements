#!/bin/bash
# Export all environment variables from config.env
# Usage: source export-env.sh

# Navigate to server directory
cd "$(dirname "$0")"

# Read config.env and export each variable
while IFS= read -r line || [ -n "$line" ]; do
  # Skip empty lines and comments
  [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
  
  # Remove any leading/trailing whitespace
  line=$(echo "$line" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
  
  # Export the variable (handles quoted values)
  export "$line"
done < config.env

echo "✅ Exported all variables from config.env"
echo "📝 Variables are now available in this shell session"




