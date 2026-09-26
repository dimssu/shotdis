export function Unsupported({ reason }: { reason: 'mobile' | 'webgl' }) {
  return (
    <div className="unsupported">
      <div className="box">
        <h1 className="logo" style={{ justifyContent: 'center' }}>
          <span className="dot" />
          SHOTDIS
        </h1>
        {reason === 'mobile' ? (
          <>
            <p>
              <strong>SHOTDIS is currently designed for keyboard + mouse.</strong>
            </p>
            <p>Open this page on a desktop or laptop browser to play. A touch version is not available yet.</p>
          </>
        ) : (
          <>
            <p>
              <strong>Your browser could not start WebGL.</strong>
            </p>
            <p>SHOTDIS needs hardware 3D graphics. Try a current version of Chrome, Edge or Firefox, and make sure hardware acceleration is enabled in the browser settings.</p>
          </>
        )}
      </div>
    </div>
  );
}
