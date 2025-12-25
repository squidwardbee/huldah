/**
 * Direct Credentials Form
 *
 * Stores Polymarket API credentials in browser localStorage for direct trading.
 * Credentials never leave the browser - all trading happens client-side.
 */

import { useState } from 'react';
import { useDirectTrading } from '../../hooks/useDirectTrading';

interface DirectCredentialsFormProps {
  onSuccess?: () => void;
  onCancel?: () => void;
}

export function DirectCredentialsForm({ onSuccess, onCancel }: DirectCredentialsFormProps) {
  const { saveCredentials, clearCredentials, hasCredentials, verifyCredentials } = useDirectTrading();

  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [apiPassphrase, setApiPassphrase] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      // Save credentials to localStorage
      const saved = saveCredentials(apiKey, apiSecret, apiPassphrase);

      if (!saved) {
        setError('Failed to save credentials');
        return;
      }

      // Optionally verify credentials work
      setIsVerifying(true);
      const valid = await verifyCredentials();

      if (valid) {
        setSuccess('Credentials verified and saved!');
        setApiKey('');
        setApiSecret('');
        setApiPassphrase('');

        setTimeout(() => {
          onSuccess?.();
        }, 1000);
      } else {
        // Credentials saved but verification failed - might still work
        setSuccess('Credentials saved! (Verification pending)');
        setApiKey('');
        setApiSecret('');
        setApiPassphrase('');

        setTimeout(() => {
          onSuccess?.();
        }, 1500);
      }
    } catch (err: any) {
      console.error('Failed to save credentials:', err);
      setError(err.message || 'Failed to save credentials');
    } finally {
      setIsSubmitting(false);
      setIsVerifying(false);
    }
  };

  const handleDelete = () => {
    clearCredentials();
    setShowDeleteConfirm(false);
    setSuccess('Credentials deleted');
  };

  return (
    <div className="bg-terminal-surface border border-terminal-border rounded-lg p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-white font-mono text-sm font-semibold">TRADING CREDENTIALS</h3>
        {onCancel && (
          <button
            onClick={onCancel}
            className="text-terminal-muted hover:text-white text-xl leading-none"
          >
            &times;
          </button>
        )}
      </div>

      {!hasCredentials ? (
        <>
          <div className="bg-neon-cyan/10 border border-neon-cyan/30 rounded-lg p-3 mb-4">
            <p className="text-neon-cyan text-xs font-mono">
              DIRECT TRADING - Credentials stored locally in your browser.
            </p>
          </div>

          <p className="text-terminal-muted text-sm mb-4">
            To trade directly on Polymarket, you need your CLOB API credentials.
            Get them from your{' '}
            <a
              href="https://polymarket.com/settings/api"
              target="_blank"
              rel="noopener noreferrer"
              className="text-neon-cyan hover:underline"
            >
              Polymarket API settings
            </a>.
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-terminal-muted text-xs uppercase tracking-widest mb-2">
                API Key
              </label>
              <input
                type="text"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Enter your API key"
                className="
                  w-full bg-terminal-bg border border-terminal-border rounded-lg
                  px-3 py-2 font-mono text-sm text-white
                  focus:outline-none focus:border-neon-cyan
                  placeholder:text-terminal-muted/50
                "
                autoComplete="off"
                required
              />
            </div>

            <div>
              <label className="block text-terminal-muted text-xs uppercase tracking-widest mb-2">
                API Secret
              </label>
              <input
                type="password"
                value={apiSecret}
                onChange={(e) => setApiSecret(e.target.value)}
                placeholder="Enter your API secret"
                className="
                  w-full bg-terminal-bg border border-terminal-border rounded-lg
                  px-3 py-2 font-mono text-sm text-white
                  focus:outline-none focus:border-neon-cyan
                  placeholder:text-terminal-muted/50
                "
                autoComplete="off"
                required
              />
            </div>

            <div>
              <label className="block text-terminal-muted text-xs uppercase tracking-widest mb-2">
                API Passphrase
              </label>
              <input
                type="password"
                value={apiPassphrase}
                onChange={(e) => setApiPassphrase(e.target.value)}
                placeholder="Enter your API passphrase"
                className="
                  w-full bg-terminal-bg border border-terminal-border rounded-lg
                  px-3 py-2 font-mono text-sm text-white
                  focus:outline-none focus:border-neon-cyan
                  placeholder:text-terminal-muted/50
                "
                autoComplete="off"
                required
              />
            </div>

            {error && (
              <div className="bg-neon-red/10 border border-neon-red/30 rounded-lg p-3 text-neon-red text-sm">
                {error}
              </div>
            )}

            {success && (
              <div className="bg-neon-green/10 border border-neon-green/30 rounded-lg p-3 text-neon-green text-sm">
                {success}
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting || !apiKey || !apiSecret || !apiPassphrase}
              className="
                w-full py-3 rounded-lg font-mono font-bold text-sm
                bg-neon-cyan text-black hover:bg-neon-cyan/80
                disabled:opacity-50 disabled:cursor-not-allowed
                transition-all duration-200
              "
            >
              {isVerifying ? 'Verifying...' : isSubmitting ? 'Saving...' : 'Save Credentials'}
            </button>
          </form>

          <div className="mt-4 p-3 bg-terminal-bg/50 rounded-lg">
            <h4 className="text-terminal-muted text-xs uppercase tracking-widest mb-2">
              How to get API credentials:
            </h4>
            <ol className="text-xs text-terminal-muted/70 space-y-1 list-decimal list-inside">
              <li>Go to <span className="text-neon-cyan">polymarket.com/settings/api</span></li>
              <li>Click "Create API Key"</li>
              <li>Copy the Key, Secret, and Passphrase</li>
              <li>Paste them here</li>
            </ol>
          </div>

          <div className="mt-4 text-xs text-terminal-muted/50">
            Your credentials are stored locally in your browser and never sent to our servers.
            All trades are executed directly with Polymarket.
          </div>
        </>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-neon-green">
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
            <span className="font-mono text-sm">Trading credentials configured</span>
          </div>

          <p className="text-terminal-muted text-sm">
            Your Polymarket API credentials are stored locally in your browser.
            You can trade directly on Polymarket.
          </p>

          {error && (
            <div className="bg-neon-red/10 border border-neon-red/30 rounded-lg p-3 text-neon-red text-sm">
              {error}
            </div>
          )}

          {success && (
            <div className="bg-neon-green/10 border border-neon-green/30 rounded-lg p-3 text-neon-green text-sm">
              {success}
            </div>
          )}

          {showDeleteConfirm ? (
            <div className="bg-neon-red/10 border border-neon-red/30 rounded-lg p-4">
              <p className="text-white text-sm mb-3">
                Are you sure you want to delete your credentials? You won't be able to trade until you add them again.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={handleDelete}
                  className="
                    flex-1 py-2 rounded-lg font-mono text-sm
                    bg-neon-red text-white hover:bg-neon-red/80
                  "
                >
                  Yes, Delete
                </button>
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  className="
                    flex-1 py-2 rounded-lg font-mono text-sm
                    bg-terminal-muted/30 text-white hover:bg-terminal-muted/50
                  "
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="
                w-full py-2 rounded-lg font-mono text-sm
                bg-terminal-muted/20 text-terminal-muted hover:bg-terminal-muted/30 hover:text-white
                transition-colors
              "
            >
              Delete Credentials
            </button>
          )}
        </div>
      )}
    </div>
  );
}
