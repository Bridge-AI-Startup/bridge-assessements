# Create Your Own MongoDB Database User

## The Problem
You're using your teammate's database credentials (`Saaz`), but you need your own database user to connect. Organization permissions ≠ database access credentials.

## Solution: Create Your Own Database User

### Step 1: Go to Database Access
1. Go to MongoDB Atlas: https://cloud.mongodb.com
2. Select your project
3. Click **"Database Access"** in the left sidebar (NOT "Network Access")

### Step 2: Add New Database User
1. Click the green **"Add New Database User"** button
2. Fill in the form:

   **Authentication Method:**
   - Select **"Password"**

   **Username:**
   - Enter your username (e.g., `austin` or `austinflippo`)

   **Password:**
   - Click **"Autogenerate Secure Password"** (recommended)
   - OR enter your own password
   - ⚠️ **IMPORTANT**: Copy the password immediately! You won't see it again.

   **Database User Privileges:**
   - Select **"Atlas admin"** (gives full access)
   - OR **"Read and write to any database"** (more restrictive but usually sufficient)

3. Click **"Add User"**

### Step 3: Update Your Connection String
1. Copy the username and password you just created
2. Open `server/config.env`
3. Update the `ATLAS_URI` line:

   **Old (teammate's credentials):**
   ```
   ATLAS_URI=mongodb+srv://Saaz:aLYPqISmCkhoKNPc@cluster0.aafx9z6.mongodb.net/?appName=Cluster0
   ```

   **New (your credentials):**
   ```
   ATLAS_URI=mongodb+srv://YOUR_USERNAME:YOUR_PASSWORD@cluster0.aafx9z6.mongodb.net/?appName=Cluster0
   ```

   Replace:
   - `YOUR_USERNAME` with your new database username
   - `YOUR_PASSWORD` with your new password

### Step 4: Test the Connection
```bash
cd server
npm run start
```

You should now see:
```
✅ Successfully connected to MongoDB with Mongoose!
```

## Alternative: Get Connection String from Atlas

If you want to be extra sure, you can get the full connection string from Atlas:

1. Go to **"Clusters"** → Click **"Connect"** on your cluster
2. Choose **"Connect your application"**
3. Select **"Node.js"** and version **"5.5 or later"**
4. Copy the connection string
5. Replace `<username>` and `<password>` with your new database user credentials
6. Update `config.env` with the complete connection string

## Important Notes

- **Database users are separate from organization members**
- Each person needs their own database user credentials
- The connection string format: `mongodb+srv://USERNAME:PASSWORD@cluster...`
- Make sure to URL-encode special characters in passwords if needed

## Troubleshooting

If you still get connection errors after creating your user:

1. **Wait 1-2 minutes** - User creation can take a moment to propagate
2. **Verify password** - Make sure you copied it correctly (no extra spaces)
3. **Check IP whitelist** - You already have `0.0.0.0/0`, so this should be fine
4. **Verify cluster is running** - Check that cluster status is "Active"
