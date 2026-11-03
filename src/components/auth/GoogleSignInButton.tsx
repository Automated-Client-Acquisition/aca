import { useEffect, useRef, useCallback, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";

interface GoogleSignInButtonProps {
  onSuccess?: () => void;
  onError?: (error: Error) => void;
}

export function GoogleSignInButton({ onSuccess, onError }: GoogleSignInButtonProps) {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
  const buttonRef = useRef<HTMLDivElement>(null);
  const nonceRef = useRef<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);

  // Generate a secure nonce for token verification
  const generateNonce = useCallback(async () => {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    const nonce = Array.from(array, (byte) => byte.toString(16).padStart(2, "0")).join("");
    nonceRef.current = nonce;

    // Hash the nonce with SHA-256 for Google
    const encoder = new TextEncoder();
    const data = encoder.encode(nonce);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  }, []);

  useEffect(() => {
    if (!clientId) return;

    let isMounted = true;
    let checkInterval: NodeJS.Timeout | null = null;

    const handleCredentialResponse = async (response: google.accounts.id.CredentialResponse) => {
      if (!isMounted) return;

      setIsLoading(true);
      try {
        const { data, error } = await supabase.auth.signInWithIdToken({
          provider: "google",
          token: response.credential,
          nonce: nonceRef.current,
        });

        if (error) throw error;
        if (isMounted) {
          onSuccess?.();
        }
      } catch (error) {
        if (isMounted) {
          onError?.(error as Error);
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    const initButton = (hashedNonce: string) => {
      if (!window.google || !buttonRef.current || !isMounted) return;

      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: handleCredentialResponse,
        nonce: hashedNonce,
        use_fedcm_for_prompt: true,
      });

      window.google.accounts.id.renderButton(buttonRef.current, {
        type: "standard",
        theme: "outline",
        size: "large",
        text: "continue_with",
        locale: "en",
        shape: "rectangular",
        width: 300,
      });

      if (isMounted) {
        setIsInitialized(true);
      }
    };

    const initializeGoogle = async () => {
      const hashedNonce = await generateNonce();

      // Wait for Google script to load
      if (!window.google) {
        checkInterval = setInterval(() => {
          if (window.google && isMounted) {
            if (checkInterval) clearInterval(checkInterval);
            initButton(hashedNonce);
          }
        }, 100);

        // Timeout after 10 seconds
        setTimeout(() => {
          if (checkInterval) clearInterval(checkInterval);
          if (!isInitialized && isMounted) {
            console.error("Google Identity Services failed to load");
          }
        }, 10000);
      } else {
        initButton(hashedNonce);
      }
    };

    initializeGoogle();

    return () => {
      isMounted = false;
      if (checkInterval) clearInterval(checkInterval);
    };
  }, [clientId, generateNonce, onSuccess, onError, isInitialized]);

  if (!clientId) return null;

  return (
    <div className="w-full flex justify-center min-h-[44px] items-center">
      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Signing in...</span>
        </div>
      ) : (
        <div ref={buttonRef} />
      )}
    </div>
  );
}
