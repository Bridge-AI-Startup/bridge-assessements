// Ported from the Framer code component "DevToolsStack"
// (framer imports + property controls stripped; logic/styles verbatim).
import { useState, useEffect } from "react"
import { motion } from "framer-motion"

const STAGGER = 600
const SETTLE_PAUSE = 2400
const INITIAL_DELAY = 400
const ease = [0.22, 1, 0.36, 1]

const cards = [
    {
        label: "Claude Prompt",
        color: "#8b5cf6",
        yFinal: 30,
        type: "text",
        text: "Optimize time complexity for this function",
    },
    {
        label: "Chrome Research",
        color: "#3b82f6",
        yFinal: 10,
        type: "links",
        items: ["StackOverflow", "Binary search explanation"],
    },
    {
        label: "VS Code",
        color: "#22c55e",
        yFinal: -10,
        type: "code",
    },
    {
        label: "Terminal",
        color: "#f59e0b",
        yFinal: -30,
        type: "terminal",
        lines: ["$ npm test", "✓ all tests passed"],
    },
]

function CardBody({ card }) {
    if (card.type === "text") {
        return (
            <p
                style={{
                    margin: 0,
                    fontSize: 12.5,
                    color: "#4b5068",
                    lineHeight: 1.4,
                }}
            >
                {card.text}
            </p>
        )
    }

    if (card.type === "links") {
        return (
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                {card.items.map((t, i) => (
                    <div
                        key={i}
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 7,
                        }}
                    >
                        <span
                            style={{
                                fontSize: 9,
                                color: "#3b82f6",
                                opacity: 0.6,
                            }}
                        >
                            ◎
                        </span>
                        <span style={{ fontSize: 12, color: "#4b5068" }}>
                            {t}
                        </span>
                    </div>
                ))}
            </div>
        )
    }

    if (card.type === "code") {
        return (
            <div
                style={{
                    background: "#f8f9fb",
                    borderRadius: 8,
                    padding: "8px 10px",
                    fontFamily: "monospace",
                    fontSize: 11,
                    lineHeight: 1.55,
                }}
            >
                <div style={{ whiteSpace: "pre" }}>
                    <span style={{ color: "#8b5cf6" }}>{"function "}</span>
                    <span style={{ color: "#3b82f6" }}>{"twoSum"}</span>
                    <span style={{ color: "#64748b" }}>{"(nums) {"}</span>
                </div>
                <div style={{ whiteSpace: "pre", color: "#64748b" }}>
                    {"  return nums.sort((a,b)=>a-b)"}
                </div>
                <div style={{ whiteSpace: "pre", color: "#64748b" }}>{"}"}</div>
            </div>
        )
    }

    if (card.type === "terminal") {
        return (
            <div
                style={{
                    background: "#1e1e2e",
                    borderRadius: 8,
                    padding: "8px 10px",
                    fontFamily: "monospace",
                    fontSize: 11,
                    lineHeight: 1.6,
                }}
            >
                {card.lines.map((line, i) => (
                    <div
                        key={i}
                        style={{
                            color: line.startsWith("✓") ? "#22c55e" : "#94a3b8",
                        }}
                    >
                        {line}
                    </div>
                ))}
            </div>
        )
    }

    return null
}

export default function DevToolsStack(props) {
    const [visibleCount, setVisibleCount] = useState(0)
    const [key, setKey] = useState(0)

    useEffect(() => {
        let timer

        if (visibleCount < cards.length) {
            timer = setTimeout(
                () => setVisibleCount((c) => c + 1),
                visibleCount === 0 ? INITIAL_DELAY : STAGGER
            )
        } else {
            timer = setTimeout(() => {
                setVisibleCount(0)
                setKey((k) => k + 1)
            }, SETTLE_PAUSE)
        }

        return () => clearTimeout(timer)
    }, [visibleCount, key])

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
            {cards.map((card, i) => (
                <motion.div
                    key={`${key}-${i}`}
                    initial={false}
                    animate={{
                        opacity: i < visibleCount ? 1 : 0,
                        y: i < visibleCount ? card.yFinal : 40,
                    }}
                    transition={{
                        duration: 0.5,
                        ease: ease,
                    }}
                    style={{
                        position: "absolute",
                        width: "84%",
                        background: "#fff",
                        borderRadius: 13,
                        padding: "12px 16px 14px",
                        boxShadow:
                            "0 1px 2px rgba(0,0,0,0.04), 0 4px 16px rgba(0,0,0,0.05), 0 0 0 1px rgba(0,0,0,0.03)",
                        zIndex: i + 1,
                        pointerEvents: i < visibleCount ? "auto" : "none",
                    }}
                >
                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 7,
                            marginBottom: 8,
                        }}
                    >
                        <div
                            style={{
                                width: 6,
                                height: 6,
                                borderRadius: "50%",
                                background: card.color,
                                flexShrink: 0,
                            }}
                        />
                        <span
                            style={{
                                fontSize: 11,
                                fontWeight: 600,
                                color: "#1a1d2e",
                                letterSpacing: "0.01em",
                                textTransform: "uppercase",
                                opacity: 0.7,
                            }}
                        >
                            {card.label}
                        </span>
                    </div>
                    <div
                        style={{
                            height: 1,
                            background:
                                "linear-gradient(90deg, rgba(0,0,0,0.04), rgba(0,0,0,0.06), rgba(0,0,0,0.02))",
                            marginBottom: 10,
                        }}
                    />
                    <CardBody card={card} />
                </motion.div>
            ))}
        </div>
    )
}
