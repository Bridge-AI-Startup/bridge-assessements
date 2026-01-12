# MongoDB Connection Troubleshooting

## Error: `querySrv ECONNREFUSED`

This error means your application cannot connect to MongoDB Atlas. Here are the most common causes and solutions:

## ✅ Solution 1: Whitelist Your IP Address (Most Common)

MongoDB Atlas requires you to whitelist IP addresses that can connect to your cluster.

### Steps:

1. **Go to MongoDB Atlas Dashboard**
   - Visit: https://cloud.mongodb.com
   - Log in to your account

2. **Navigate to Network Access**
   - Click on your project
   - Go to **Network Access** in the left sidebar
   - Click **Add IP Address** or **IP Access List**

3. **Add Your IP Address**
   - **Option A (Recommended for Development)**: Click **Add Current IP Address** button
   - **Option B (Less Secure)**: Add `0.0.0.0/0` to allow all IPs (only for development!)
   - Click **Confirm**

4. **Wait 1-2 minutes** for changes to propagate

5. **Try connecting again**:
   ```bash
   cd server
   npm run dev
   ```

## ✅ Solution 2: Check if Cluster is Paused

Free tier MongoDB Atlas clusters automatically pause after 1 week of inactivity.

### Steps:

1. **Go to MongoDB Atlas Dashboard**
   - Visit: https://cloud.mongodb.com
   - Navigate to your cluster

2. **Check Cluster Status**
   - If the cluster shows "Paused", click **Resume** or **Resume Cluster**
   - Wait 1-2 minutes for the cluster to resume

3. **Try connecting again**

## ✅ Solution 3: Verify Connection String

Make sure your connection string in `server/config.env` is correct:

```env
ATLAS_URI=mongodb+srv://username:password@cluster0.xxxxx.mongodb.net/?appName=Cluster0
```

**Check:**
- Username and password are correct
- Cluster name matches your actual cluster
- No extra spaces or quotes around the connection string

## ✅ Solution 4: Test Connection Directly

You can test the connection using MongoDB Compass or `mongosh`:

### Using MongoDB Compass:
1. Download MongoDB Compass: https://www.mongodb.com/try/download/compass
2. Paste your connection string
3. Click Connect
4. If it fails, you'll see a more detailed error message

### Using mongosh CLI:
```bash
# Install mongosh if needed
brew install mongosh

# Test connection
mongosh "mongodb+srv://username:password@cluster0.xxxxx.mongodb.net/?appName=Cluster0"
```

## ✅ Solution 5: Check Network/Firewall

If you're on a corporate network or VPN:

1. **Try from a different network** (e.g., mobile hotspot)
2. **Disable VPN** temporarily
3. **Check firewall settings** - MongoDB Atlas uses port 27017

## ✅ Solution 6: Verify Database User

Make sure the database user exists and has the correct permissions:

1. **Go to MongoDB Atlas Dashboard**
2. **Navigate to Database Access**
3. **Check if your user exists** and has proper permissions
4. **Reset password** if needed (update `config.env` with new password)

## 🔍 Debugging Steps

1. **Check server logs** for more detailed error messages
2. **Verify environment variables are loaded**:
   ```bash
   cd server
   node -e "require('dotenv').config({path: 'config.env'}); console.log(process.env.ATLAS_URI)"
   ```

3. **Test with a simple connection script**:
   ```javascript
   // test-connection.js
   require('dotenv').config({path: 'config.env'});
   const mongoose = require('mongoose');
   
   mongoose.connect(process.env.ATLAS_URI, {
     dbName: process.env.DB_NAME || 'bridge-assessments'
   })
   .then(() => console.log('✅ Connected!'))
   .catch(err => console.error('❌ Error:', err));
   ```

## 📝 Quick Checklist

- [ ] IP address is whitelisted in MongoDB Atlas Network Access
- [ ] Cluster is not paused (resume if needed)
- [ ] Connection string is correct in `config.env`
- [ ] Database user exists and password is correct
- [ ] Not behind a restrictive firewall/VPN
- [ ] Waited 1-2 minutes after making changes

## 🆘 Still Not Working?

1. **Check MongoDB Atlas Status**: https://status.mongodb.com/
2. **Review MongoDB Atlas Logs**: Check for any security alerts
3. **Try creating a new database user** with a fresh password
4. **Contact MongoDB Support** if using a paid tier

## 💡 Pro Tip

For local development, you can use `0.0.0.0/0` in Network Access to allow all IPs. **Remember to remove this before production!**
