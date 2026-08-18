// Ported from the Framer code component "PrizePodium". Not mounted on the
// landing page (it belongs to the hackathon page on the live site); kept here
// so it's available in code. CSS reset scoped to .podium-root.
const PRIZES = [
    {
        place: "2nd",
        label: "Second Place",
        color: "#94a3b8",
        bg: "rgba(241,245,249,0.9)",
        border: "rgba(203,213,225,0.7)",
        height: 120,
        rewards: [{ logo: "OpenAI", amount: "$200", color: "#000" }],
    },
    {
        place: "1st",
        label: "First Place",
        color: "#eab308",
        bg: "rgba(255,252,240,0.92)",
        border: "rgba(253,224,71,0.5)",
        height: 160,
        rewards: [
            { logo: "Claude", amount: "$200", color: "#d97706" },
            { logo: "OpenAI", amount: "$200", color: "#000" },
        ],
    },
    {
        place: "3rd",
        label: "Third Place",
        color: "#d97706",
        bg: "rgba(255,251,235,0.88)",
        border: "rgba(253,186,116,0.5)",
        height: 90,
        rewards: [{ logo: "OpenAI", amount: "$150", color: "#000" }],
    },
]

export default function PrizePodium() {
    return (
        <>
            <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700&family=JetBrains+Mono:wght@400;500&display=swap');
        .podium-root, .podium-root * { box-sizing: border-box; margin: 0; }

        .podium-root {
          width: 100%;
          font-family: 'DM Sans', sans-serif;
          background: transparent;
        }

        .podium-root .podium-glass {
          width: 100%;
          background: rgba(255,255,255,0.55);
          backdrop-filter: blur(24px);
          -webkit-backdrop-filter: blur(24px);
          border: 1px solid rgba(255,255,255,0.6);
          border-radius: 24px;
          padding: 32px 28px 28px;
          box-shadow:
            0 0 0 1px rgba(255,255,255,0.15) inset,
            0 8px 40px rgba(0,0,0,0.06),
            0 2px 12px rgba(0,0,0,0.04);
          overflow: hidden;
        }

        .podium-root .podium-row {
          display: flex;
          gap: 14px;
          align-items: flex-end;
          width: 100%;
        }

        .podium-root .podium-card {
          flex: 1;
          border-radius: 14px;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          transition: transform .2s ease, box-shadow .2s ease;
          cursor: default;
        }
        .podium-root .podium-card:hover {
          transform: translateY(-4px);
          box-shadow: 0 8px 28px rgba(0,0,0,0.08);
        }

        .podium-root .card-top {
          padding: 20px 16px 16px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
        }

        .podium-root .place-badge {
          font-size: 28px;
          font-weight: 700;
          font-family: 'JetBrains Mono', monospace;
          line-height: 1;
          letter-spacing: -1px;
        }

        .podium-root .place-label {
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 1px;
          text-transform: uppercase;
          margin-bottom: 12px;
        }

        .podium-root .reward-list {
          display: flex;
          flex-direction: column;
          gap: 6px;
          width: 100%;
        }

        .podium-root .reward-item {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 12px;
          border-radius: 8px;
          background: rgba(255,255,255,0.7);
          border: 1px solid rgba(0,0,0,0.05);
        }

        .podium-root .reward-brand {
          font-size: 12px;
          font-weight: 600;
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .podium-root .reward-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
        }

        .podium-root .reward-amount {
          font-size: 14px;
          font-weight: 700;
          font-family: 'JetBrains Mono', monospace;
        }

        .podium-root .pedestal {
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          border-top: 1px solid rgba(0,0,0,0.04);
          font-size: 11px;
          font-weight: 600;
          color: rgba(0,0,0,0.2);
          font-family: 'JetBrains Mono', monospace;
          letter-spacing: 1px;
        }

        .podium-root .podium-card-1 {
          box-shadow: 0 2px 16px rgba(234,179,8,0.1);
        }
        .podium-root .podium-card-1:hover {
          box-shadow: 0 8px 32px rgba(234,179,8,0.15);
        }

        @media (max-width: 600px) {
          .podium-root .podium-glass { padding: 20px 14px; }
          .podium-root .podium-row { gap: 8px; }
          .podium-root .card-top { padding: 14px 12px 12px; }
          .podium-root .place-badge { font-size: 22px; }
          .podium-root .reward-item { padding: 6px 8px; }
          .podium-root .reward-brand { font-size: 11px; }
          .podium-root .reward-amount { font-size: 12px; }
        }
      `}</style>

            <div className="podium-root">
                <div className="podium-glass">
                    <div className="podium-row">
                        {PRIZES.map((p, i) => (
                            <div
                                key={i}
                                className={`podium-card ${i === 1 ? "podium-card-1" : ""}`}
                                style={{
                                    background: p.bg,
                                    border: `1px solid ${p.border}`,
                                }}
                            >
                                <div className="card-top">
                                    <div
                                        className="place-badge"
                                        style={{ color: p.color }}
                                    >
                                        {p.place}
                                    </div>
                                    <div
                                        className="place-label"
                                        style={{ color: p.color, opacity: 0.7 }}
                                    >
                                        {p.label}
                                    </div>

                                    <div className="reward-list">
                                        {p.rewards.map((r, j) => (
                                            <div
                                                className="reward-item"
                                                key={j}
                                            >
                                                <span
                                                    className="reward-brand"
                                                    style={{ color: r.color }}
                                                >
                                                    <span
                                                        className="reward-dot"
                                                        style={{
                                                            background: r.color,
                                                        }}
                                                    />
                                                    {r.logo}
                                                </span>
                                                <span
                                                    className="reward-amount"
                                                    style={{ color: r.color }}
                                                >
                                                    {r.amount}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                <div
                                    className="pedestal"
                                    style={{
                                        height: p.height,
                                        background: p.bg,
                                    }}
                                ></div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </>
    )
}
