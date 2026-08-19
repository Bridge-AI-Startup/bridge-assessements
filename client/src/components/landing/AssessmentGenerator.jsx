// Ported from the Framer code component "Assessment Generator"
// (framer imports + property controls stripped; logic/styles verbatim).
import { useState, useEffect } from "react"
import { motion } from "framer-motion"

const PHASES = { JD: 0, PULSE: 1, TRANSFORM: 2, HOLD: 3 }
const TIMINGS = { JD: 1800, PULSE: 1400, TRANSFORM: 1100, HOLD: 2800 }
const ease = [0.22, 1, 0.36, 1]

const jdItems = [
    "Frontend Engineer",
    "React + APIs",
    "Performance optimization",
]
const specItems = [
    "Build a React dashboard",
    "Fetch API data",
    "Render chart components",
    "Handle loading states",
    "Optimize performance",
]

export default function AssessmentGenerator(props) {
    const { startDelay = 0 } = props
    const [phase, setPhase] = useState(-1)
    const [started, setStarted] = useState(false)

    useEffect(() => {
        const timer = setTimeout(() => {
            setStarted(true)
            setPhase(PHASES.JD)
        }, startDelay * 1000)
        return () => clearTimeout(timer)
         
    }, [])

    useEffect(() => {
        if (!started || phase < 0) return
        const durations = [
            TIMINGS.JD,
            TIMINGS.PULSE,
            TIMINGS.TRANSFORM,
            TIMINGS.HOLD,
        ]
        const timeout = setTimeout(() => {
            setPhase((p) => (p + 1) % 4)
        }, durations[phase])
        return () => clearTimeout(timeout)
    }, [phase, started])

    const showJD = started && (phase === PHASES.JD || phase === PHASES.PULSE)
    const showSpec =
        started && (phase === PHASES.TRANSFORM || phase === PHASES.HOLD)
    const isPulsing = phase === PHASES.PULSE

    return (
        <div
            style={{
                position: "relative",
                width: props.style?.width || 340,
                height: props.style?.height || 310,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontFamily:
                    "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
                overflow: "hidden",
                ...props.style,
            }}
        >
            <div
                style={{
                    position: "relative",
                    zIndex: 1,
                    width: "100%",
                    padding: "20px 22px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    minHeight: 270,
                }}
            >
                {/* Job Description Card */}
                <motion.div
                    animate={{
                        opacity: showJD ? 1 : 0,
                        y: showJD ? 0 : showSpec ? -18 : 14,
                        scale: showJD ? 1 : 0.97,
                    }}
                    transition={{ duration: 0.45, ease }}
                    style={{
                        position: "absolute",
                        width: "calc(100% - 44px)",
                        background: "#fff",
                        borderRadius: 13,
                        padding: "16px 18px 18px",
                        boxShadow:
                            "0 1px 2px rgba(0,0,0,0.04), 0 4px 16px rgba(0,0,0,0.05), 0 0 0 1px rgba(0,0,0,0.03)",
                        pointerEvents: showJD ? "auto" : "none",
                    }}
                >
                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            marginBottom: 10,
                        }}
                    >
                        <div
                            style={{
                                width: 7,
                                height: 7,
                                borderRadius: "50%",
                                background: "rgba(99,102,241,0.7)",
                                flexShrink: 0,
                            }}
                        />
                        <span
                            style={{
                                fontSize: 13,
                                fontWeight: 600,
                                color: "#1a1d2e",
                                letterSpacing: "-0.01em",
                                flex: 1,
                            }}
                        >
                            Job Description
                        </span>
                    </div>
                    <div
                        style={{
                            height: 1,
                            background:
                                "linear-gradient(90deg, rgba(0,0,0,0.04), rgba(0,0,0,0.06), rgba(0,0,0,0.02))",
                            marginBottom: 12,
                        }}
                    />
                    <ul
                        style={{
                            listStyle: "none",
                            margin: 0,
                            padding: 0,
                            display: "flex",
                            flexDirection: "column",
                            gap: 7,
                        }}
                    >
                        {jdItems.map((item, i) => (
                            <motion.li
                                key={item}
                                animate={{
                                    opacity: showJD ? 1 : 0,
                                    x: showJD ? 0 : -8,
                                }}
                                transition={{
                                    delay: showJD ? 0.08 + i * 0.09 : 0,
                                    duration: 0.35,
                                    ease,
                                }}
                                style={{
                                    fontSize: 12.5,
                                    color: "#4b5068",
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 8,
                                    lineHeight: 1.35,
                                }}
                            >
                                <span
                                    style={{
                                        color: "#9496a8",
                                        fontSize: 13,
                                        fontWeight: 500,
                                        flexShrink: 0,
                                        width: 12,
                                        textAlign: "center",
                                    }}
                                >
                                    ›
                                </span>
                                {item}
                            </motion.li>
                        ))}
                    </ul>
                    <motion.div
                        animate={{
                            opacity: isPulsing ? 1 : showJD ? 0.5 : 0,
                            scale: isPulsing ? [1, 1.04, 1] : 0.96,
                        }}
                        transition={
                            isPulsing
                                ? {
                                      scale: { repeat: 2, duration: 0.35 },
                                      opacity: { duration: 0.2 },
                                  }
                                : { duration: 0.3 }
                        }
                        style={{
                            marginTop: 14,
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 6,
                            fontSize: 11.5,
                            fontWeight: 600,
                            color: "#fff",
                            background:
                                "linear-gradient(135deg, #6366f1 0%, #5457e5 100%)",
                            padding: "7px 14px",
                            borderRadius: 8,
                            letterSpacing: "0.01em",
                            cursor: "default",
                            width: "fit-content",
                            boxShadow: isPulsing
                                ? "0 0 0 3px rgba(99,102,241,0.15), 0 2px 8px rgba(99,102,241,0.25)"
                                : "0 1px 3px rgba(0,0,0,0.06)",
                        }}
                    >
                        Generate Assessment
                    </motion.div>
                </motion.div>

                {/* Take-Home Project Card */}
                <motion.div
                    animate={{
                        opacity: showSpec ? 1 : 0,
                        y: showSpec ? 0 : 20,
                        scale: showSpec ? 1 : 0.96,
                    }}
                    transition={{ duration: 0.5, ease }}
                    style={{
                        position: "absolute",
                        width: "calc(100% - 44px)",
                        background: "#fff",
                        borderRadius: 13,
                        padding: "16px 18px 18px",
                        boxShadow:
                            "0 1px 2px rgba(0,0,0,0.04), 0 4px 16px rgba(0,0,0,0.05), 0 0 0 1px rgba(0,0,0,0.03)",
                        pointerEvents: showSpec ? "auto" : "none",
                    }}
                >
                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            marginBottom: 10,
                        }}
                    >
                        <div
                            style={{
                                width: 7,
                                height: 7,
                                borderRadius: "50%",
                                background: "rgba(16,185,129,0.7)",
                                flexShrink: 0,
                            }}
                        />
                        <span
                            style={{
                                fontSize: 13,
                                fontWeight: 600,
                                color: "#1a1d2e",
                                letterSpacing: "-0.01em",
                                flex: 1,
                            }}
                        >
                            Take-Home Project
                        </span>
                        <motion.span
                            animate={{
                                opacity: showSpec ? 1 : 0,
                                scale: showSpec ? 1 : 0,
                            }}
                            transition={{
                                delay: showSpec ? 0.25 : 0,
                                duration: 0.35,
                                ease,
                            }}
                            style={{
                                fontSize: 10,
                                fontWeight: 600,
                                color: "#10b981",
                                background: "rgba(16,185,129,0.08)",
                                padding: "2px 8px",
                                borderRadius: 20,
                                letterSpacing: "0.02em",
                                textTransform: "uppercase",
                            }}
                        >
                            Generated
                        </motion.span>
                    </div>
                    <div
                        style={{
                            height: 1,
                            background:
                                "linear-gradient(90deg, rgba(0,0,0,0.04), rgba(0,0,0,0.06), rgba(0,0,0,0.02))",
                            marginBottom: 12,
                        }}
                    />
                    <ul
                        style={{
                            listStyle: "none",
                            margin: 0,
                            padding: 0,
                            display: "flex",
                            flexDirection: "column",
                            gap: 7,
                        }}
                    >
                        {specItems.map((item, i) => (
                            <motion.li
                                key={item}
                                animate={{
                                    opacity: showSpec ? 1 : 0,
                                    x: showSpec ? 0 : -10,
                                }}
                                transition={{
                                    delay: showSpec ? 0.1 + i * 0.07 : 0,
                                    duration: 0.32,
                                    ease,
                                }}
                                style={{
                                    fontSize: 12.5,
                                    color: "#4b5068",
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 8,
                                    lineHeight: 1.35,
                                }}
                            >
                                <span
                                    style={{
                                        color: "#10b981",
                                        fontSize: 11,
                                        fontWeight: 700,
                                        flexShrink: 0,
                                        width: 12,
                                        textAlign: "center",
                                    }}
                                >
                                    ✓
                                </span>
                                {item}
                            </motion.li>
                        ))}
                    </ul>
                </motion.div>
            </div>
        </div>
    )
}
