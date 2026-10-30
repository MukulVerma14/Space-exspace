import { useState, useEffect } from 'react';

export default function App() {
  const [healthStatus, setHealthStatus] = useState<string>('Checking...');
  const [isSecureContext, setIsSecureContext] = useState<boolean>(true);

  useEffect(() => {
    // Check if running in a secure context (HTTPS or localhost)
    if (typeof window !== 'undefined') {
      setIsSecureContext(window.isSecureContext);
    }

    // Ping /health endpoint (served on the same origin via Caddy reverse proxy)
    fetch('/health')
      .then((res) => res.json())
      .then((data) => setHealthStatus(data.status === 'ok' ? 'Online & Healthy' : 'Degraded'))
      .catch(() => setHealthStatus('Offline / Connecting...'));
  }, []);

  return (
    <div style={{ fontFamily: 'system-ui, -apple-system, sans-serif', padding: '2rem', maxWidth: '800px', margin: '0 auto' }}>
      <header style={{ borderBottom: '2px solid #e5e7eb', paddingBottom: '1rem', marginBottom: '2rem' }}>
        <h1 style={{ color: '#111827', margin: 0 }}>SPACE EXSPACE</h1>
        <p style={{ color: '#4b5563', margin: '0.25rem 0 0 0' }}>Industrial Equipment &amp; Materials Fleet Platform</p>
      </header>

      <main>
        <section style={{ background: '#f9fafb', padding: '1.5rem', borderRadius: '8px', border: '1px solid #e5e7eb', marginBottom: '1.5rem' }}>
          <h2 style={{ fontSize: '1.25rem', marginTop: 0 }}>API System Status</h2>
          <p>
            Status: <strong>{healthStatus}</strong> (Same-Origin Reverse Proxy via Caddy)
          </p>
        </section>

        <section style={{ background: isSecureContext ? '#ecfdf5' : '#fef2f2', padding: '1.5rem', borderRadius: '8px', border: `1px solid ${isSecureContext ? '#10b981' : '#ef4444'}` }}>
          <h2 style={{ fontSize: '1.25rem', marginTop: 0, color: isSecureContext ? '#065f46' : '#991b1b' }}>
            Camera QR Scanning Readiness
          </h2>
          <p style={{ color: isSecureContext ? '#047857' : '#b91c1c' }}>
            {isSecureContext ? (
              <>
                ✅ <strong>Secure Context Active (HTTPS):</strong> Browser camera access (<code>navigator.mediaDevices.getUserMedia</code>) is authorized for field QR code scanning.
              </>
            ) : (
              <>
                ⚠️ <strong>Insecure Context Detected:</strong> Modern browsers strictly block camera scanning over plaintext HTTP. Access via automatic HTTPS provided by Caddy reverse proxy.
              </>
            )}
          </p>
        </section>
      </main>
    </div>
  );
}
