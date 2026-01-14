'use client';

import { useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/utils/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';

export function ForgotPasswordForm() {
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isEmailSent, setIsEmailSent] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; general?: string }>({});

  const validateForm = () => {
    const newErrors: { email?: string } = {};
    let isValid = true;

    if (!email) {
      newErrors.email = 'Email is required';
      isValid = false;
    } else if (!/\S+@\S+\.\S+/.test(email)) {
      newErrors.email = 'Email is invalid';
      isValid = false;
    }

    setErrors(newErrors);
    return isValid;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validateForm()) {
      return;
    }

    setIsLoading(true);
    setErrors({});

    try {
      const supabase = createClient();
      
      // Use Supabase's resetPasswordForEmail to send reset email
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      
      if (error) {
        setErrors({ general: error.message });
        toast.error('Failed to send reset email', {
          description: error.message
        });
      } else {
        setIsEmailSent(true);
        toast.success('Reset email sent', {
          description: 'Please check your email for password reset instructions'
        });
      }
    } catch {
      setErrors({ general: 'An unexpected error occurred' });
      toast.error('Failed to send reset email', {
        description: 'An unexpected error occurred'
      });
    } finally {
      setIsLoading(false);
    }
  };

  if (isEmailSent) {
    return (
      <div className="w-full max-w-md space-y-6">
        <div className="space-y-2 text-center">
          <h1 className="text-3xl font-bold">Check your email</h1>
          <p className="text-gray-500 dark:text-gray-400">
            We&apos;ve sent password reset instructions to <strong>{email}</strong>
          </p>
        </div>
        
        <div className="space-y-4">
          <p className="text-sm text-gray-600 dark:text-gray-400 text-center">
            Click the link in the email to reset your password. If you don&apos;t see it, check your spam folder.
          </p>
          
          <div className="text-center space-y-2">
            <Button
              variant="outline"
              onClick={() => {
                setIsEmailSent(false);
                setEmail('');
              }}
              className="w-full"
            >
              Send another email
            </Button>
            <Link href="/login" className="block text-sm text-blue-500 hover:underline">
              Back to login
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md space-y-6">
      <div className="space-y-2 text-center">
        <h1 className="text-3xl font-bold">Reset password</h1>
        <p className="text-gray-500 dark:text-gray-400">
          Enter your email address and we&apos;ll send you a link to reset your password
        </p>
      </div>
      
      <form onSubmit={handleSubmit} className="space-y-4">
        {errors.general && (
          <div className="p-3 text-sm text-white bg-red-500 rounded">
            {errors.general}
          </div>
        )}
        
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            placeholder="name@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={isLoading}
          />
          {errors.email && <p className="text-sm text-red-500">{errors.email}</p>}
        </div>
        
        <Button type="submit" className="w-full" disabled={isLoading}>
          {isLoading ? 'Sending...' : 'Send reset link'}
        </Button>
      </form>
      
      <div className="text-center text-sm">
        Remember your password?{' '}
        <Link href="/login" className="text-blue-500 hover:underline">
          Sign in
        </Link>
      </div>
    </div>
  );
}
