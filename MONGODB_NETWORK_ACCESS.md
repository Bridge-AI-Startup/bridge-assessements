# MongoDB Atlas Network Access - Step by Step

## The Issue
You have all the right **project roles** (permissions), but MongoDB is still refusing the connection because your **IP address isn't whitelisted** in Network Access.

**Project Roles** = What you can do (read, write, manage)
**Network Access** = Which IPs can connect (firewall/security)

## Step-by-Step Fix

### 1. Go to MongoDB Atlas Dashboard
- Visit: https://cloud.mongodb.com
- Log in with your account (atmflippo@gmail.com)

### 2. Select Your Project
- Click on the project that contains your cluster (likely "bridge-assessments" or similar)

### 3. Navigate to Network Access
- Look at the **left sidebar**
- Find **"Network Access"** (it's usually near the bottom, below "Database Access")
- Click on **"Network Access"**

### 4. Check Current IP Whitelist
- You'll see a list of IP addresses
- If the list is empty or doesn't include your current IP, that's the problem

### 5. Add Your IP Address
- Click the green **"Add IP Address"** button (top right)
- You have two options:

#### Option A: Add Current IP (Recommended)
- Click **"Add Current IP Address"** button
- This automatically detects and adds your computer's IP
- Click **"Confirm"**

#### Option B: Allow All IPs (Development Only)
- Click **"Add IP Address"**
- Enter: `0.0.0.0/0`
- Add a comment: "Development - allow all IPs"
- Click **"Confirm"**
- ⚠️ **Warning**: Remove this before production!

### 6. Wait for Changes
- MongoDB Atlas needs 1-2 minutes to apply the changes
- You'll see your IP address appear in the list with status "Active"

### 7. Test Connection
- Go back to your terminal
- Run: `cd server && npm run start`
- You should now see: `✅ Successfully connected to MongoDB with Mongoose!`

## Visual Guide

```
MongoDB Atlas Dashboard
├── Projects (top)
├── Your Project
│   ├── Overview
│   ├── Database Access ← (This is where your roles are - NOT what we need)
│   ├── Network Access ← (THIS IS WHAT WE NEED!)
│   │   └── Add IP Address button
│   ├── Clusters
│   └── ...
```

## Common Mistakes

❌ **Wrong**: Going to "Database Access" (that's for user roles)
✅ **Right**: Going to "Network Access" (that's for IP whitelist)

❌ **Wrong**: Thinking project roles fix network access
✅ **Right**: Network Access is separate from project roles

## Still Not Working?

1. **Check if cluster is paused**: Go to "Clusters" → Check if it says "Paused" → Click "Resume"
2. **Verify connection string**: Make sure `ATLAS_URI` in `config.env` is correct
3. **Check firewall/VPN**: Try from a different network or disable VPN
4. **Wait longer**: Sometimes it takes 2-3 minutes for changes to propagate

## Quick Test

After adding your IP, you can test the connection directly:

```bash
# Test MongoDB connection
mongosh "mongodb+srv://Saaz:aLYPqISmCkhoKNPc@cluster0.aafx9z6.mongodb.net/?appName=Cluster0"
```

If this works, your server connection will work too!
