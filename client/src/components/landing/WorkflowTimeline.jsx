// Ported from the Framer code component "Workflow Timeline"
// (framer imports + property controls stripped; logic/styles verbatim).
import { useState, useEffect } from "react"
import { motion } from "framer-motion"

const STEP_DELAY = 550
const SETTLE_PAUSE = 2200
const INITIAL_DELAY = 350
const ease = [0.22, 1, 0.36, 1]
const TOTAL_STEPS = 4

const TL_LEFT = 30
const TL_RIGHT = 340
const TL_WIDTH = TL_RIGHT - TL_LEFT
const CARD_W = 105
const TL_Y = "50%"

const events = [
    {
        label: "Chrome",
        color: "#64748b",
        cardColor: "#3b82f6",
        text: "Researched binary search",
        dot: 48,
        side: "below",
    },
    {
        label: "Claude",
        color: "#64748b",
        cardColor: "#8b5cf6",
        text: "Refactor time complexity",
        dot: 138,
        side: "above",
    },
    {
        label: "Cursor",
        color: "#64748b",
        cardColor: "#22c55e",
        text: "Edited solution logic",
        dot: 228,
        side: "below",
    },
    {
        label: "Terminal",
        color: "#64748b",
        cardColor: "#f59e0b",
        text: "Ran tests, verified",
        dot: 318,
        side: "above",
    },
]

function MiniCard({ color, label, text }) {
    return (
        <div
            style={{
                width: CARD_W,
                background: "#fff",
                borderRadius: 10,
                padding: "7px 10px 8px",
                boxShadow:
                    "0 1px 3px rgba(0,0,0,0.06), 0 4px 14px rgba(0,0,0,0.06), 0 0 0 1px rgba(0,0,0,0.04)",
            }}
        >
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 5,
                    marginBottom: 4,
                }}
            >
                <div
                    style={{
                        width: 5,
                        height: 5,
                        borderRadius: "50%",
                        background: color,
                        flexShrink: 0,
                    }}
                />
                <span
                    style={{
                        fontSize: 9,
                        fontWeight: 600,
                        color: "#1a1d2e",
                        textTransform: "uppercase",
                        letterSpacing: "0.02em",
                        opacity: 0.6,
                    }}
                >
                    {label}
                </span>
            </div>
            <p
                style={{
                    margin: 0,
                    fontSize: 10.5,
                    color: "#4b5068",
                    lineHeight: 1.35,
                }}
            >
                {text}
            </p>
        </div>
    )
}

export default function WorkflowTimeline(props) {
    const { startDelay = 0 } = props
    const [step, setStep] = useState(0)
    const [key, setKey] = useState(0)
    const [started, setStarted] = useState(false)

    useEffect(() => {
        const timer = setTimeout(() => setStarted(true), startDelay * 1000)
        return () => clearTimeout(timer)
         
    }, [])

    useEffect(() => {
        if (!started) return
        let timer

        if (step < TOTAL_STEPS) {
            timer = setTimeout(
                () => setStep((s) => s + 1),
                step === 0 ? INITIAL_DELAY : STEP_DELAY
            )
        } else {
            timer = setTimeout(() => {
                setStep(0)
                setKey((k) => k + 1)
            }, SETTLE_PAUSE)
        }

        return () => clearTimeout(timer)
    }, [step, key, started])

    const visibleEvents = Math.max(0, Math.min(step, 4))
    const timelineProgress = visibleEvents / events.length
    const panX = -Math.min(visibleEvents, 4) * 8

    return (
        <div
            style={{
                position: "relative",
                width: props.style?.width || 380,
                height: props.style?.height || 300,
                overflow: "hidden",
                fontFamily:
                    "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
                ...props.style,
            }}
        >
            <motion.div
                key={key}
                initial={false}
                animate={{ x: panX }}
                transition={{ duration: 0.6, ease }}
                style={{
                    position: "absolute",
                    top: 0,
                    left: 12,
                    right: 12,
                    height: "100%",
                }}
            >
                <div
                    style={{
                        position: "absolute",
                        top: TL_Y,
                        left: TL_LEFT,
                        width: TL_WIDTH,
                        height: 3,
                        background: "rgba(0,0,0,0.08)",
                        borderRadius: 2,
                        marginTop: -1.5,
                    }}
                />

                <motion.div
                    initial={false}
                    animate={{ width: TL_WIDTH * timelineProgress }}
                    transition={{ duration: 0.5, ease }}
                    style={{
                        position: "absolute",
                        top: TL_Y,
                        left: TL_LEFT,
                        height: 3,
                        background: "linear-gradient(90deg, #64748b, #94a3b8)",
                        borderRadius: 2,
                        marginTop: -1.5,
                        opacity: 0.35,
                    }}
                />

                {events.map((evt, i) => (
                    <motion.div
                        key={"dot-" + i}
                        initial={false}
                        animate={{
                            opacity: i < visibleEvents ? 1 : 0,
                            scale: i < visibleEvents ? 1 : 0,
                        }}
                        transition={{ duration: 0.3, ease }}
                        style={{
                            position: "absolute",
                            top: TL_Y,
                            left: evt.dot - 5,
                            marginTop: -5,
                            width: 10,
                            height: 10,
                            borderRadius: "50%",
                            background: evt.color,
                            boxShadow: "0 0 0 3px rgba(255,255,255,0.9)",
                            zIndex: 2,
                        }}
                    />
                ))}

                {events.map((evt, i) => (
                    <motion.div
                        key={"conn-" + i}
                        initial={false}
                        animate={{
                            opacity: i < visibleEvents ? 0.2 : 0,
                            scaleY: i < visibleEvents ? 1 : 0,
                        }}
                        transition={{ duration: 0.35, ease }}
                        style={{
                            position: "absolute",
                            left: evt.dot - 0.5,
                            width: 1,
                            height: 18,
                            background: evt.color,
                            transformOrigin:
                                evt.side === "below" ? "top" : "bottom",
                            zIndex: 1,
                            ...(evt.side === "below"
                                ? { top: TL_Y, marginTop: 5 }
                                : { top: TL_Y, marginTop: -23 }),
                        }}
                    />
                ))}

                {events.map((evt, i) => (
                    <motion.div
                        key={"evt-" + i}
                        initial={false}
                        animate={{
                            opacity: i < visibleEvents ? 1 : 0,
                            y:
                                i < visibleEvents
                                    ? 0
                                    : evt.side === "below"
                                      ? -10
                                      : 10,
                        }}
                        transition={{ duration: 0.45, ease }}
                        style={{
                            position: "absolute",
                            left: evt.dot - CARD_W / 2,
                            pointerEvents: i < visibleEvents ? "auto" : "none",
                            zIndex: 1,
                            ...(evt.side === "below"
                                ? { top: TL_Y, marginTop: 26 }
                                : { top: TL_Y, marginTop: -82 }),
                        }}
                    >
                        <MiniCard
                            color={evt.cardColor}
                            label={evt.label}
                            text={evt.text}
                        />
                    </motion.div>
                ))}
            </motion.div>
        </div>
    )
}
