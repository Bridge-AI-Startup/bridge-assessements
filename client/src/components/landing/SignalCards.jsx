/**
 * The five "Understand how candidates work" dark-glass cards, ported from the
 * Framer code components AI_Usage / Communication / Research / Testing /
 * Submission (framer imports + property controls stripped; content and styles
 * verbatim, widths made responsive). Default accents match the Framer
 * property-control defaults used on the live site.
 */

const mono =
    '"SF Mono", "Fira Code", "JetBrains Mono", "Cascadia Code", monospace'
const sans =
    '"SF Pro Display", "Helvetica Neue", -apple-system, BlinkMacSystemFont, sans-serif'
const sansText =
    '"SF Pro Text", "Helvetica Neue", -apple-system, BlinkMacSystemFont, sans-serif'

const styles = {
    card: {
        width: "100%",
        maxWidth: 520,
        background: "rgba(15,15,20,0.78)",
        backdropFilter: "blur(24px)",
        WebkitBackdropFilter: "blur(24px)",
        border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: 18,
        boxShadow: "0 16px 32px rgba(0,0,0,0.3)",
        padding: "16px 20px",
        display: "flex",
        flexDirection: "column",
    },

    divider: {
        height: 1,
        background: "rgba(255,255,255,0.06)",
        margin: "12px 0",
    },

    chatThread: {
        display: "flex",
        flexDirection: "column",
        gap: 10,
    },
    chatRow: {
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
    },
    avatarUser: {
        width: 22,
        height: 22,
        borderRadius: 6,
        background: "rgba(255,255,255,0.08)",
        border: "1px solid rgba(255,255,255,0.1)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 9,
        fontWeight: 600,
        color: "rgba(255,255,255,0.45)",
        fontFamily: sans,
        flexShrink: 0,
    },
    avatarAgent: {
        width: 22,
        height: 22,
        borderRadius: 6,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 8,
        fontWeight: 700,
        fontFamily: sans,
        flexShrink: 0,
    },
    avatarSystem: {
        width: 22,
        height: 22,
        borderRadius: 6,
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.08)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 9,
        fontWeight: 700,
        color: "rgba(255,255,255,0.3)",
        fontFamily: sans,
        flexShrink: 0,
    },
    chatBubble: {
        display: "flex",
        flexDirection: "column",
        gap: 3,
        flex: 1,
        minWidth: 0,
    },
    chatSender: {
        fontSize: 9.5,
        fontWeight: 600,
        color: "rgba(255,255,255,0.42)",
        fontFamily: sans,
        letterSpacing: "0.01em",
    },
    chatMessage: {
        fontSize: 12,
        fontWeight: 400,
        lineHeight: 1.45,
        color: "rgba(255,255,255,0.82)",
        fontFamily: sansText,
    },
    metaMessage: {
        fontSize: 11,
        fontWeight: 400,
        lineHeight: 1.45,
        color: "rgba(255,255,255,0.42)",
        fontFamily: sansText,
        fontStyle: "italic",
    },
    metaFail: {
        fontSize: 11,
        fontWeight: 500,
        lineHeight: 1.45,
        color: "#F87171",
        fontFamily: sansText,
    },
    metaPass: {
        fontSize: 11,
        fontWeight: 500,
        lineHeight: 1.45,
        color: "#4ADE80",
        fontFamily: sansText,
    },

    agentContent: {
        display: "flex",
        flexDirection: "column",
        gap: 6,
    },
    codeSnippet: {
        padding: "8px 10px",
        borderRadius: 7,
        background: "rgba(0,0,0,0.35)",
        border: "1px solid rgba(255,255,255,0.06)",
        overflowX: "auto",
    },
    codeText: {
        fontSize: 9.5,
        lineHeight: 1.55,
        color: "rgba(255,255,255,0.48)",
        fontFamily: mono,
        whiteSpace: "pre",
    },

    checklist: {
        display: "flex",
        flexDirection: "column",
        gap: 10,
    },
    checkRow: {
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
    },
    checkIcon: {
        fontSize: 12,
        fontWeight: 700,
        width: 22,
        height: 22,
        borderRadius: 6,
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.08)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        fontFamily: sans,
    },
    checkContent: {
        display: "flex",
        flexDirection: "column",
        gap: 2,
        flex: 1,
        minWidth: 0,
    },
    checkLabel: {
        fontSize: 12,
        fontWeight: 600,
        color: "rgba(255,255,255,0.78)",
        fontFamily: sans,
        letterSpacing: "0.01em",
    },
    checkDetail: {
        fontSize: 11,
        fontWeight: 400,
        lineHeight: 1.4,
        color: "rgba(255,255,255,0.45)",
        fontFamily: sansText,
    },

    signalRow: {
        display: "flex",
        alignItems: "center",
        gap: 10,
    },
    signalBadge: {
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 10px",
        borderRadius: 100,
        flexShrink: 0,
    },
    signalLabel: {
        fontSize: 10.5,
        fontWeight: 700,
        letterSpacing: "0.02em",
        fontFamily: sansText,
    },
    signalText: {
        fontSize: 11.5,
        fontWeight: 400,
        lineHeight: 1.4,
        color: "rgba(255,255,255,0.65)",
        fontFamily: sansText,
    },
}

function Banner({ accentColor, title, time }) {
    return (
        <div
            style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "7px 12px",
                borderRadius: 8,
                background: `${accentColor}12`,
                border: `1px solid ${accentColor}20`,
            }}
        >
            <div
                style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: accentColor,
                }}
            />
            <span
                style={{
                    fontSize: 10.5,
                    fontWeight: 600,
                    letterSpacing: "0.03em",
                    color: accentColor,
                    fontFamily: sans,
                }}
            >
                {title}
            </span>
            <span
                style={{
                    fontSize: 10,
                    color: "rgba(255,255,255,0.3)",
                    fontFamily: sansText,
                    marginLeft: "auto",
                }}
            >
                {time}
            </span>
        </div>
    )
}

function Signal({ accentColor, label, text }) {
    return (
        <div style={styles.signalRow}>
            <div
                style={{
                    ...styles.signalBadge,
                    background: `${accentColor}14`,
                    border: `1px solid ${accentColor}28`,
                }}
            >
                <span
                    style={{
                        width: 5,
                        height: 5,
                        borderRadius: "50%",
                        background: accentColor,
                        flexShrink: 0,
                    }}
                />
                <span style={{ ...styles.signalLabel, color: accentColor }}>
                    {label}
                </span>
            </div>
            <span style={styles.signalText}>{text}</span>
        </div>
    )
}

function UserRow({ children, meta = false }) {
    return (
        <div style={styles.chatRow}>
            <div style={styles.avatarUser}>C</div>
            <div style={styles.chatBubble}>
                <span style={styles.chatSender}>Candidate</span>
                <span style={meta ? styles.metaMessage : styles.chatMessage}>
                    {children}
                </span>
            </div>
        </div>
    )
}

function AgentRow({ accentColor, name, avatar, children }) {
    return (
        <div style={styles.chatRow}>
            <div
                style={{
                    ...styles.avatarAgent,
                    background: `${accentColor}20`,
                    color: accentColor,
                }}
            >
                {avatar}
            </div>
            <div style={styles.chatBubble}>
                <span
                    style={{
                        ...styles.chatSender,
                        color: accentColor,
                        opacity: 0.8,
                    }}
                >
                    {name}
                </span>
                {children}
            </div>
        </div>
    )
}

export function AIUsageCard({ accentColor = "#60A5FA" }) {
    return (
        <div style={styles.card}>
            <Banner
                accentColor={accentColor}
                title="AI Prompt Detected"
                time="2:34 PM"
            />
            <div style={styles.divider} />
            <div style={styles.chatThread}>
                <UserRow>
                    Refactor twoSum from O(n log n) sort-based approach to O(n)
                    using a hash map lookup
                </UserRow>
                <AgentRow accentColor={accentColor} name="Claude" avatar="AI">
                    <div style={styles.agentContent}>
                        <span style={styles.chatMessage}>
                            Here&apos;s the O(n) solution using a Map for
                            constant-time lookups:
                        </span>
                        <div style={styles.codeSnippet}>
                            <code style={styles.codeText}>
                                {"const map = new Map();\n"}
                                {"for (let i = 0; i < nums.length; i++) {\n"}
                                {"  if (map.has(target - nums[i]))\n"}
                                {"    return [map.get(target-nums[i]), i];\n"}
                                {"  map.set(nums[i], i);\n"}
                                {"}"}
                            </code>
                        </div>
                    </div>
                </AgentRow>
                <UserRow>Add early validation for empty arrays?</UserRow>
            </div>
            <div style={styles.divider} />
            <Signal
                accentColor={accentColor}
                label="AI Usage"
                text="Targeted optimization prompt — specified exact complexity tradeoff (O(n log n) → O(n)) and data structure preference"
            />
        </div>
    )
}

export function CommunicationCard({ accentColor = "#34D399" }) {
    return (
        <div style={styles.card}>
            <Banner
                accentColor={accentColor}
                title="Communication Analyzed"
                time="2:41 PM"
            />
            <div style={styles.divider} />
            <div style={styles.chatThread}>
                <AgentRow
                    accentColor={accentColor}
                    name="Bridge Agent"
                    avatar="B"
                >
                    <span style={styles.chatMessage}>
                        Walk me through your approach before you start coding.
                        What tradeoffs are you considering?
                    </span>
                </AgentRow>
                <UserRow>
                    I&apos;m thinking hash map for O(n) time but that&apos;s
                    O(n) space. Sorting would be O(1) space but O(n log n) time
                    — I&apos;ll go with the hash map since the input size is
                    unbounded
                </UserRow>
                <AgentRow
                    accentColor={accentColor}
                    name="Bridge Agent"
                    avatar="B"
                >
                    <span style={styles.chatMessage}>
                        What happens if the array contains duplicates?
                    </span>
                </AgentRow>
                <UserRow>
                    Good catch — the map stores the latest index so duplicates
                    are handled. We check before inserting so we won&apos;t
                    match an element with itself
                </UserRow>
            </div>
            <div style={styles.divider} />
            <Signal
                accentColor={accentColor}
                label="Communication"
                text="Articulated tradeoffs unprompted — justified decision with constraints and handled edge case reasoning clearly"
            />
        </div>
    )
}

export function ResearchCard({ accentColor = "#F97316" }) {
    return (
        <div style={styles.card}>
            <Banner
                accentColor={accentColor}
                title="Web Research Detected"
                time="2:19 PM"
            />
            <div style={styles.divider} />
            <div style={styles.chatThread}>
                <UserRow meta>
                    Searched: &quot;JavaScript Map vs Object performance&quot;
                </UserRow>
                <UserRow>
                    Confirmed Map.has() runs in constant time — using Map over
                    a plain object for reliable key lookups
                </UserRow>
                <UserRow meta>
                    Searched: &quot;Array indexOf time complexity&quot;
                </UserRow>
                <UserRow>
                    Ruled out indexOf — too slow for this use case. Sticking
                    with Map
                </UserRow>
            </div>
            <div style={styles.divider} />
            <Signal
                accentColor={accentColor}
                label="Research"
                text="Used official documentation over forums — verified assumptions before committing to a solution"
            />
        </div>
    )
}

export function TestingCard({ accentColor = "#A78BFA" }) {
    return (
        <div style={styles.card}>
            <Banner
                accentColor={accentColor}
                title="Test Iteration Tracked"
                time="2:47 PM"
            />
            <div style={styles.divider} />
            <div style={styles.chatThread}>
                <div style={styles.chatRow}>
                    <div style={styles.avatarSystem}>1</div>
                    <div style={styles.chatBubble}>
                        <span style={styles.chatSender}>Attempt 1</span>
                        <span style={styles.metaFail}>
                            ✕ Failed — duplicate values returned wrong index
                        </span>
                    </div>
                </div>
                <UserRow>
                    The map is overwriting the first index before I check for a
                    match. I need to move the lookup before the insert
                </UserRow>
                <div style={styles.chatRow}>
                    <div style={styles.avatarSystem}>2</div>
                    <div style={styles.chatBubble}>
                        <span style={styles.chatSender}>Attempt 2</span>
                        <span style={styles.metaFail}>
                            ✕ Failed — empty array throws unhandled error
                        </span>
                    </div>
                </div>
                <UserRow>
                    Missing an edge case guard. Adding an early return for
                    arrays shorter than 2 elements
                </UserRow>
                <div style={styles.chatRow}>
                    <div style={styles.avatarSystem}>3</div>
                    <div style={styles.chatBubble}>
                        <span style={styles.chatSender}>Attempt 3</span>
                        <span style={styles.metaPass}>✓ All tests passed</span>
                    </div>
                </div>
            </div>
            <div style={styles.divider} />
            <Signal
                accentColor={accentColor}
                label="Testing"
                text="Identified root cause each attempt — fixed ordering bug then added edge case handling in 3 iterations"
            />
        </div>
    )
}

export function SubmissionCard({ accentColor = "#22D3EE" }) {
    const checks = [
        {
            pass: true,
            label: "Correctness",
            detail: "All test cases passed including edge cases",
        },
        {
            pass: true,
            label: "Time Complexity",
            detail: "O(n) solution — optimal for input size",
        },
        {
            pass: true,
            label: "Input Validation",
            detail: "Handles empty arrays and missing targets",
        },
        {
            pass: true,
            label: "Readability",
            detail: "Clear variable names and consistent formatting",
        },
        {
            pass: false,
            label: "Documentation",
            detail: "No comments or JSDoc explaining function behavior",
        },
    ]

    return (
        <div style={styles.card}>
            <Banner
                accentColor={accentColor}
                title="Final Submission Evaluated"
                time="3:12 PM"
            />
            <div style={styles.divider} />
            <div style={styles.checklist}>
                {checks.map((item, i) => (
                    <div key={i} style={styles.checkRow}>
                        <span
                            style={{
                                ...styles.checkIcon,
                                color: item.pass ? "#4ADE80" : "#F87171",
                            }}
                        >
                            {item.pass ? "✓" : "✕"}
                        </span>
                        <div style={styles.checkContent}>
                            <span style={styles.checkLabel}>{item.label}</span>
                            <span style={styles.checkDetail}>
                                {item.detail}
                            </span>
                        </div>
                    </div>
                ))}
            </div>
            <div style={styles.divider} />
            <Signal
                accentColor={accentColor}
                label="Submission"
                text="Correct and well-structured solution with strong edge case coverage — minor gap in inline documentation"
            />
        </div>
    )
}
