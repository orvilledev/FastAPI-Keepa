/**
 * CSS-animated SVG capybara — no external asset, fails soft if CSS unavailable.
 */
export default function DancingCapybara({ className = '' }: { className?: string }) {
  return (
    <div className={`relative mx-auto flex h-44 w-44 items-end justify-center ${className}`} aria-hidden>
      <div className="capy-dance origin-bottom">
        <svg viewBox="0 0 160 140" className="h-40 w-40 drop-shadow-lg" role="img">
          <title>Dancing capybara</title>
          {/* ground shadow */}
          <ellipse cx="80" cy="128" rx="42" ry="8" fill="rgba(0,0,0,0.12)" className="capy-shadow" />
          {/* body */}
          <ellipse cx="78" cy="88" rx="48" ry="32" fill="#C4A574" />
          <ellipse cx="78" cy="92" rx="40" ry="24" fill="#D4B896" />
          {/* head */}
          <ellipse cx="118" cy="62" rx="28" ry="24" fill="#C4A574" />
          <ellipse cx="124" cy="66" rx="18" ry="14" fill="#D4B896" />
          {/* ears */}
          <ellipse cx="108" cy="42" rx="8" ry="10" fill="#B8956A" className="capy-ear-l" />
          <ellipse cx="128" cy="40" rx="7" ry="9" fill="#B8956A" className="capy-ear-r" />
          <ellipse cx="108" cy="43" rx="4" ry="5" fill="#E8C4A8" />
          <ellipse cx="128" cy="41" rx="3.5" ry="4.5" fill="#E8C4A8" />
          {/* eyes */}
          <circle cx="122" cy="58" r="3.2" fill="#2C2416" />
          <circle cx="134" cy="56" r="3.2" fill="#2C2416" />
          <circle cx="122.8" cy="57" r="1" fill="#fff" />
          <circle cx="134.8" cy="55" r="1" fill="#fff" />
          {/* snout */}
          <ellipse cx="140" cy="68" rx="10" ry="8" fill="#A67C52" />
          <ellipse cx="137" cy="66" rx="2" ry="2.5" fill="#2C2416" />
          <ellipse cx="143" cy="66" rx="2" ry="2.5" fill="#2C2416" />
          {/* smile */}
          <path d="M134 72 Q140 76 146 72" stroke="#2C2416" strokeWidth="1.5" fill="none" strokeLinecap="round" />
          {/* legs dancing */}
          <g className="capy-leg-front">
            <ellipse cx="58" cy="112" rx="10" ry="14" fill="#B8956A" />
            <ellipse cx="58" cy="122" rx="11" ry="5" fill="#8B6914" />
          </g>
          <g className="capy-leg-back">
            <ellipse cx="98" cy="112" rx="10" ry="14" fill="#B8956A" />
            <ellipse cx="98" cy="122" rx="11" ry="5" fill="#8B6914" />
          </g>
          {/* tiny party hat */}
          <path d="M118 28 L128 48 L108 48 Z" fill="#F97316" />
          <circle cx="118" cy="26" r="4" fill="#81B81D" className="capy-pompom" />
        </svg>
      </div>
      <style>{`
        @keyframes capy-bounce {
          0%, 100% { transform: translateY(0) rotate(-4deg); }
          25% { transform: translateY(-14px) rotate(3deg); }
          50% { transform: translateY(0) rotate(-2deg); }
          75% { transform: translateY(-10px) rotate(4deg); }
        }
        @keyframes capy-leg {
          0%, 100% { transform: rotate(-12deg); }
          50% { transform: rotate(14deg); }
        }
        @keyframes capy-leg-alt {
          0%, 100% { transform: rotate(10deg); }
          50% { transform: rotate(-14deg); }
        }
        @keyframes capy-ear {
          0%, 100% { transform: rotate(0deg); }
          50% { transform: rotate(-8deg); }
        }
        @keyframes capy-shadow {
          0%, 100% { transform: scaleX(1); opacity: 0.12; }
          50% { transform: scaleX(0.7); opacity: 0.08; }
        }
        @keyframes capy-pompom {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-3px); }
        }
        .capy-dance { animation: capy-bounce 0.7s ease-in-out infinite; }
        .capy-leg-front { transform-origin: 58px 100px; animation: capy-leg 0.35s ease-in-out infinite; }
        .capy-leg-back { transform-origin: 98px 100px; animation: capy-leg-alt 0.35s ease-in-out infinite; }
        .capy-ear-l, .capy-ear-r { transform-origin: center; animation: capy-ear 0.7s ease-in-out infinite; }
        .capy-shadow { transform-origin: center; animation: capy-shadow 0.7s ease-in-out infinite; }
        .capy-pompom { transform-origin: center; animation: capy-pompom 0.7s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          .capy-dance, .capy-leg-front, .capy-leg-back, .capy-ear-l, .capy-ear-r, .capy-shadow, .capy-pompom {
            animation: none !important;
          }
        }
      `}</style>
    </div>
  )
}
