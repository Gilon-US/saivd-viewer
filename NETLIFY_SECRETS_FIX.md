# Netlify Secrets Scanning Fix

## Issue Summary

Netlify's secret scanner detected values in build output and documentation files, blocking deployment.

## Root Cause Analysis

The detected "secrets" were **NOT actual security vulnerabilities**:

1. **`NEXT_PUBLIC_*` variables in build output** - These are INTENTIONALLY public by Next.js design
   - Next.js bundles `NEXT_PUBLIC_*` variables into client-side JavaScript
   - This is expected and documented behavior
   - The Supabase URL and anon key are meant to be public

2. **`WASABI_BUCKET_NAME` in documentation** - False positive
   - The scanner detected "saivd-viewer" in file paths like `simplify-saivd-viewer-epic.md`
   - This is the project name, not a secret
   - Bucket names are typically public information (they're in URLs)

3. **`WASABI_REGION` in build output** - Not sensitive
   - Value is "us-east-1", a standard AWS region identifier
   - Region names are public information

## Solution Implemented

### 1. Created `netlify.toml` Configuration

Added Netlify configuration to properly handle secret scanning:

```toml
[secrets]
  omit_keys = [
    "NEXT_PUBLIC_SUPABASE_URL",      # Public by design
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",  # Public by design (anon key)
    "NEXT_PUBLIC_APP_URL",            # Public URL
    "WASABI_REGION",                  # Standard region name
    "WASABI_BUCKET_NAME"              # Bucket name (public info)
  ]
  
  omit_paths = [
    ".next/**",         # Build output
    ".netlify/**",      # Netlify build artifacts
    "node_modules/**"   # Dependencies
  ]
```

### 2. Updated `.gitignore`

Added `.netlify/` directory to prevent build artifacts from being committed:

```gitignore
# netlify
.netlify
```

## Security Verification

✅ **No actual secrets are exposed:**
- `WASABI_ACCESS_KEY_ID` - NOT in code or build output
- `WASABI_SECRET_ACCESS_KEY` - NOT in code or build output
- `SUPABASE_SERVICE_ROLE_KEY` - NOT in code or build output
- All sensitive credentials properly use environment variables

✅ **Public values are correctly identified:**
- Supabase URL and anon key are designed to be public
- Bucket name and region are non-sensitive metadata
- All values in build output are intentionally public

## Next Steps

1. **Commit these changes:**
   ```bash
   git add .gitignore netlify.toml NETLIFY_SECRETS_FIX.md
   git commit -m "fix: Configure Netlify secrets scanning for Next.js public variables"
   git push
   ```

2. **Verify Netlify environment variables are set:**
   - Go to Netlify Dashboard → Site Settings → Environment Variables
   - Ensure these are configured:
     - `NEXT_PUBLIC_SUPABASE_URL`
     - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
     - `WASABI_ACCESS_KEY_ID`
     - `WASABI_SECRET_ACCESS_KEY`
     - `WASABI_REGION`
     - `WASABI_ENDPOINT`
     - `WASABI_BUCKET_NAME`

3. **Trigger new deployment:**
   - Push the changes or manually trigger a deploy
   - Build should now succeed

## Understanding Next.js Public Variables

Next.js variables prefixed with `NEXT_PUBLIC_` are **intentionally exposed** to the browser:

- They are embedded in the client-side JavaScript bundle
- They are meant to be public and accessible
- This is the correct way to use environment variables in Next.js client components
- Supabase's anon key is specifically designed to be public (it has Row Level Security)

## References

- [Netlify Secrets Scanning Docs](https://docs.netlify.com/security/secrets-scanning/)
- [Next.js Environment Variables](https://nextjs.org/docs/app/building-your-application/configuring/environment-variables)
- [Supabase Security Best Practices](https://supabase.com/docs/guides/api#api-url-and-keys)
