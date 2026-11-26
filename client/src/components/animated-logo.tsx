export function AnimatedLogo({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center gap-1 ${className}`}>
      <svg
        width="28"
        height="28"
        viewBox="0 0 28 28"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="flex-shrink-0"
        aria-label="PodBrew Logo"
      >
        <rect
          x="3"
          y="10"
          width="3"
          height="8"
          fill="#1DB954"
          rx="1.5"
          className="wave-bar"
          style={{
            animation: 'waveform 1.2s ease-in-out infinite',
            animationDelay: '0s',
          }}
        />
        <rect
          x="8"
          y="6"
          width="3"
          height="16"
          fill="#1DB954"
          rx="1.5"
          className="wave-bar"
          style={{
            animation: 'waveform 1.2s ease-in-out infinite',
            animationDelay: '0.15s',
          }}
        />
        <rect
          x="13"
          y="3"
          width="3"
          height="22"
          fill="#1DB954"
          rx="1.5"
          className="wave-bar"
          style={{
            animation: 'waveform 1.2s ease-in-out infinite',
            animationDelay: '0.3s',
          }}
        />
        <rect
          x="18"
          y="7"
          width="3"
          height="14"
          fill="#1DB954"
          rx="1.5"
          className="wave-bar"
          style={{
            animation: 'waveform 1.2s ease-in-out infinite',
            animationDelay: '0.45s',
          }}
        />
        <rect
          x="23"
          y="11"
          width="3"
          height="6"
          fill="#1DB954"
          rx="1.5"
          className="wave-bar"
          style={{
            animation: 'waveform 1.2s ease-in-out infinite',
            animationDelay: '0.6s',
          }}
        />
      </svg>
      
      <span className="text-xl font-bold tracking-tight">
        Pod<span className="text-[#1DB954]">Brew</span>
      </span>
    </div>
  );
}
