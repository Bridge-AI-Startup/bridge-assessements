# Verify MongoDB Connection String

## The Problem
DNS can't resolve `cluster0.aafx9z6.mongodb.net`, which suggests the connection string might be incorrect.

## Step 1: Get the Correct Connection String from MongoDB Atlas

1. **Go to MongoDB Atlas**: https://cloud.mongodb.com
2. **Select your project**
3. **Go to "Clusters"** (left sidebar)
4. **Click "Connect"** button on your cluster
5. **Choose "Connect your application"**
6. **Copy the connection string** - it should look like:
   ```
   mongodb+srv://<username>:<password>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
   ```

## Step 2: Verify Your Connection String

Your current connection string in `config.env`:
```
ATLAS_URI=mongodb+srv://Saaz:aLYPqISmCkhoKNPc@cluster0.aafx9z6.mongodb.net/?appName=Cluster0
```

**Check:**
- ✅ Username: `Saaz` - Does this user exist in "Database Access"?
- ✅ Password: `aLYPqISmCkhoKNPc` - Is this the correct password?
- ❓ Cluster hostname: `cluster0.aafx9z6.mongodb.net` - Does this match what Atlas shows?

## Step 3: Test the Connection

### Option A: Test with mongosh (if installed)
```bash
cd server
mongosh "mongodb+srv://Saaz:aLYPqISmCkhoKNPc@cluster0.aafx9z6.mongodb.net/?appName=Cluster0"
```

### Option B: Get Fresh Connection String from Atlas
1. In MongoDB Atlas, click "Connect" on your cluster
2. Choose "Connect your application"
3. Select "Node.js" and version "5.5 or later"
4. Copy the connection string
5. Replace `<password>` with your actual password
6. Update `config.env` with the new connection string

## Step 4: Common Issues

### Issue 1: Wrong Cluster Name
- The cluster might have a different name
- Check the actual cluster name in Atlas
- Update the connection string accordingly

### Issue 2: Password Needs URL Encoding
- If your password has special characters, they need to be URL-encoded
- Example: `@` becomes `%40`, `#` becomes `%23`

### Issue 3: Database User Doesn't Exist
- Go to "Database Access"
- Verify user `Saaz` exists
- If not, create it or use a different user

### Issue 4: Connection String Format
- Make sure it starts with `mongodb+srv://`
- Make sure there's no space before/after the string
- Make sure the password doesn't have extra quotes

## Step 5: Update config.env

Once you have the correct connection string:

1. Open `server/config.env`
2. Update the `ATLAS_URI` line with the correct connection string
3. Make sure to include the database name in the connection string or keep `DB_NAME` separate:
   ```
   ATLAS_URI=mongodb+srv://username:password@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
   DB_NAME=bridge-assessments
   ```

## Quick Test Script

Create a test file to verify connection:

```javascript
// test-mongo.js
require('dotenv').config({path: 'config.env'});
const mongoose = require('mongoose');

const uri = process.env.ATLAS_URI;
console.log('Connecting to:', uri.replace(/\/\/[^:]+:[^@]+@/, '//***:***@'));

mongoose.connect(uri, {
  dbName: process.env.DB_NAME || 'bridge-assessments'
})
.then(() => {
  console.log('✅ Connected successfully!');
  process.exit(0);
})
.catch(err => {
  console.error('❌ Connection failed:', err.message);
  process.exit(1);
});
```

Run it:
```bash
cd server
node test-mongo.js
```
