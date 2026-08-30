import { useEffect, useState } from "react";

type FrictionGuardProps = {
  countdownSeconds: number;
  clickCount: number;
  onSuccess: () => void;
  onCancel: () => void;
  title: string;
};

export function FrictionGuard({
  countdownSeconds,
  clickCount,
  onSuccess,
  onCancel,
  title,
}: FrictionGuardProps) {
  const [remainingSeconds, setRemainingSeconds] = useState(countdownSeconds);
  const [remainingClicks, setRemainingClicks] = useState(clickCount);

  useEffect(() => {
    if (remainingSeconds > 0) {
      const timer = setInterval(() => {
        setRemainingSeconds((s) => s - 1);
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [remainingSeconds]);

  useEffect(() => {
    if (remainingSeconds <= 0 && remainingClicks <= 0) {
      onSuccess();
    }
  }, [remainingSeconds, remainingClicks, onSuccess]);

  const handleProgress = () => {
    if (remainingSeconds > 0) return;
    setRemainingClicks((c) => c - 1);
  };

  return (
    <div className="overlay-root">
      <div className="overlay-content">
        <p className="eyebrow">Control Mode Active</p>
        <h1>{title}</h1>
        
        {remainingSeconds > 0 ? (
          <div className="friction-stage">
            <p className="message">Wait for the countdown to finish...</p>
            <div className="counter">{remainingSeconds}s</div>
          </div>
        ) : remainingClicks > 0 ? (
          <div className="friction-stage">
            <p className="message">Click the button {remainingClicks} times to proceed.</p>
            <button className="btn-friction" onClick={handleProgress}>
              {remainingClicks} clicks remaining
            </button>
          </div>
        ) : null}

        <button className="btn-link" onClick={onCancel} style={{ marginTop: '20px' }}>
          Cancel and stay protected
        </button>
      </div>
    </div>
  );
}
