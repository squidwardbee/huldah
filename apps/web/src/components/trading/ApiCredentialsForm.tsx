import { useState } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { registerCredentials, deleteCredentials } from '../../lib/tradingApi';

interface ApiCredentialsFormProps {
  onSuccess?: () => void;
  onCancel?: () => void;
}

export function ApiCredentialsForm({ onSuccess, onCancel }: ApiCredentialsFormProps) {
  const { token, hasCredentials, setHasCredentials } = useAuthStore();
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [apiPassphrase, setApiPassphrase] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;

    setIsSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      await registerCredentials(token, { apiKey, apiSecret, apiPassphrase });
      setSuccess('Credentials saved successfully!');
      setHasCredentials(true);

      // Clear form
      setApiKey('');
      setApiSecret('');
      setApiPassphrase('');

      // Notify parent
      setTimeout(() => {
        onSuccess?.();
      }, 1500);
    } catch (err: any) {
      console.error('Failed to save credentials:', err);
      setError(err.response?.data?.error || 'Failed to save credentials');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!token) return;

    setIsSubmitting(true);
    setError(null);

    try {
      await deleteCredentials(token);
      setSuccess('Credentials deleted');
      setHasCredentials(false);
      setShowDeleteConfirm(false);
    } catch (err: any) {
      console.error('Failed to delete credentials:', err);
      setError(err.response?.data?.error || 'Failed to delete credentials');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="bg-terminal-surface/80 border border-terminal-border rounded-lg p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-white font-mono text-sm font-semibold">CLOB API CREDENTIALS</h3>
        {onCancel && (
          <button
            onClick={onCancel}
            className="text-terminal-muted hover:text-white text-sm"
          >
            Cancel
          </button>
        )}
      </div>

      {!hasCredentials ? (
        <>
          <p className="text-terminal-muted text-sm mb-4">
            To trade on Polymarket through Huldah, you need to provide your CLOB API credentials.
            Get them from your{' '}
            <a
              href="https://polymarket.com/settings/api"
              target="_blank"
              rel="noopener noreferrer"
              className="text-neon-cyan hover:underline"
            >
              Polymarket account settings
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
              {isSubmitting ? 'Saving...' : 'Save Credentials'}
            </button>
          </form>

          <div className="mt-4 text-xs text-terminal-muted/70">
            <p>Your credentials are encrypted and stored securely. They are only used to sign orders on your behalf.</p>
          </div>
        </>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-neon-green">
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
            <span className="font-mono text-sm">API credentials configured</span>
          </div>

          <p className="text-terminal-muted text-sm">
            Your CLOB API credentials are securely stored. You can trade on Polymarket.
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
                  disabled={isSubmitting}
                  className="
                    flex-1 py-2 rounded-lg font-mono text-sm
                    bg-neon-red text-white hover:bg-neon-red/80
                    disabled:opacity-50
                  "
                >
                  {isSubmitting ? 'Deleting...' : 'Yes, Delete'}
                </button>
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  disabled={isSubmitting}
                  className="
                    flex-1 py-2 rounded-lg font-mono text-sm
                    bg-terminal-muted/30 text-white hover:bg-terminal-muted/50
                    disabled:opacity-50
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
