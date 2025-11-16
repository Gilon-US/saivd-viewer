# Netlify Setup Instructions

## Critical: Configure Secrets Scanning

Netlify's secret scanner is blocking deployment because it detects public Next.js variables in build output. This is EXPECTED behavior for Next.js, but we need to tell Netlify to allow it.

## Step-by-Step Setup

### 1. Configure Secrets Scanning in Netlify UI

**Go to your Netlify site dashboard:**

1. Navigate to **Site Settings** → **Environment Variables**
2. Click **Add a variable** and add these TWO variables:

#### Variable 1: SECRETS_SCAN_OMIT_KEYS
```
Key: SECRETS_SCAN_OMIT_KEYS
Value: NEXT_PUBLIC_SUPABASE_URL,NEXT_PUBLIC_SUPABASE_ANON_KEY,NEXT_PUBLIC_APP_URL,WASABI_REGION,WASABI_BUCKET_NAME
Scopes: All (or select specific deploy contexts)
```

#### Variable 2: SECRETS_SCAN_OMIT_PATHS
```
Key: SECRETS_SCAN_OMIT_PATHS
Value: .next/**,.netlify/**,node_modules/**,docs/**,*.md
Scopes: All (or select specific deploy contexts)
```

### 2. Add Your Application Environment Variables

While you're in Environment Variables, also add your application secrets:

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
WASABI_ACCESS_KEY_ID=your-wasabi-access-key
WASABI_SECRET_ACCESS_KEY=your-wasabi-secret-key
WASABI_REGION=us-east-1
WASABI_ENDPOINT=https://s3.us-east-1.wasabisys.com
WASABI_BUCKET_NAME=your-bucket-name
```

### 3. Deploy

After setting these environment variables:

1. Commit and push your code changes:
   ```bash
   git add netlify.toml .gitignore NETLIFY_SETUP.md NETLIFY_SECRETS_FIX.md
   git commit -m "fix: Configure Netlify secrets scanning"
   git push
   ```

2. Trigger a new deploy in Netlify (it should auto-deploy on push)

## Why This Is Needed

### Next.js Public Variables Are MEANT to Be Public

- `NEXT_PUBLIC_*` variables are **intentionally bundled** into client-side JavaScript
- This is how Next.js works - it's not a security issue
- Supabase's anon key is designed to be public (protected by Row Level Security)

### The Bucket Name and Region Are Not Secrets

- `WASABI_BUCKET_NAME`: Bucket names are visible in URLs anyway
- `WASABI_REGION`: "us-east-1" is just a standard AWS region identifier

### The Real Secrets Are Protected

These are NEVER in the code or build output:
- ✅ `WASABI_ACCESS_KEY_ID` - Only in environment variables
- ✅ `WASABI_SECRET_ACCESS_KEY` - Only in environment variables
- ✅ `SUPABASE_SERVICE_ROLE_KEY` - Only in environment variables (if used)

## Troubleshooting

### If Build Still Fails

1. **Double-check environment variables are set** in Netlify UI
2. **Clear build cache**: Site Settings → Build & Deploy → Clear cache and retry deploy
3. **Check the exact error**: Look for which files are triggering the scanner

### Alternative: Disable Secrets Scanning (Not Recommended)

If you absolutely need to bypass scanning (not recommended):

```
SECRETS_SCAN_ENABLED=false
```

But this is NOT recommended because it disables all secret detection.

## References

- [Netlify Secrets Scanning Docs](https://docs.netlify.com/security/secrets-scanning/)
- [Next.js Environment Variables](https://nextjs.org/docs/app/building-your-application/configuring/environment-variables)
- [Supabase API Keys](https://supabase.com/docs/guides/api#api-url-and-keys)
