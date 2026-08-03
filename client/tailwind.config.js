/** @type {import('tailwindcss').Config} */

/*
 * Bridge warm neutral ramp, keyed to the landing page's ink (#21201C) and
 * cream (#FAF9F2). Every grey-family and cool-accent scale in the app is
 * remapped onto this, so existing utilities like `text-gray-500` or
 * `bg-blue-100` resolve warm without touching a single JSX file.
 */
const warm = {
  50: "#FAF9F2",
  100: "#F4F2E9",
  200: "#E7E5DA",
  300: "#D6D3C5",
  400: "#B0ACA0",
  500: "#8A867B",
  600: "#6F6C63",
  700: "#57544D",
  800: "#3D3B35",
  900: "#2B2A25",
  950: "#21201C",
};

/*
 * Status colours stay distinguishable for at-a-glance scanning in the
 * submissions dashboard, but are pulled warmer and desaturated so they sit
 * next to the ink palette instead of fighting it.
 */
const brick = {
  50: "#FBF1EF",
  100: "#F7E1DD",
  200: "#EFC3BC",
  300: "#E29C92",
  400: "#D06E61",
  500: "#B94A3C",
  600: "#9E3B2E",
  700: "#802F25",
  800: "#62261E",
  900: "#4A1F19",
  950: "#2B120E",
};

const ochre = {
  50: "#FCF5E8",
  100: "#F8E9C9",
  200: "#F0D294",
  300: "#E5B75C",
  400: "#D69B31",
  500: "#B87F1C",
  600: "#966516",
  700: "#754E13",
  800: "#573A12",
  900: "#3F2A10",
  950: "#24170A",
};

const clay = {
  50: "#FDF3EA",
  100: "#F9E3CE",
  200: "#F1C69D",
  300: "#E4A467",
  400: "#D3813C",
  500: "#B96524",
  600: "#98511D",
  700: "#773F18",
  800: "#5A3015",
  900: "#422411",
  950: "#251309",
};

const sage = {
  50: "#EFF4EC",
  100: "#DCE7D7",
  200: "#BACFB0",
  300: "#93B385",
  400: "#6D955E",
  500: "#517A43",
  600: "#406236",
  700: "#334D2C",
  800: "#283C23",
  900: "#1F2E1C",
  950: "#111A10",
};

module.exports = {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx,js,jsx}"],
  theme: {
  	extend: {
  		fontFamily: {
  			sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
  			display: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'sans-serif'],
  			mono: ['"Geist Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace']
  		},
  		borderRadius: {
  			lg: 'var(--radius)',
  			md: 'calc(var(--radius) - 2px)',
  			sm: 'calc(var(--radius) - 4px)',
  			card: '20px',
  			pill: '9999px'
  		},
  		colors: {
  			background: 'hsl(var(--background))',
  			foreground: 'hsl(var(--foreground))',
  			card: {
  				DEFAULT: 'hsl(var(--card))',
  				foreground: 'hsl(var(--card-foreground))'
  			},
  			popover: {
  				DEFAULT: 'hsl(var(--popover))',
  				foreground: 'hsl(var(--popover-foreground))'
  			},
  			primary: {
  				DEFAULT: 'hsl(var(--primary))',
  				foreground: 'hsl(var(--primary-foreground))'
  			},
  			secondary: {
  				DEFAULT: 'hsl(var(--secondary))',
  				foreground: 'hsl(var(--secondary-foreground))'
  			},
  			muted: {
  				DEFAULT: 'hsl(var(--muted))',
  				foreground: 'hsl(var(--muted-foreground))'
  			},
  			accent: {
  				DEFAULT: 'hsl(var(--accent))',
  				foreground: 'hsl(var(--accent-foreground))'
  			},
  			destructive: {
  				DEFAULT: 'hsl(var(--destructive))',
  				foreground: 'hsl(var(--destructive-foreground))'
  			},
  			border: 'hsl(var(--border))',
  			input: 'hsl(var(--input))',
  			ring: 'hsl(var(--ring))',
  			chart: {
  				'1': 'hsl(var(--chart-1))',
  				'2': 'hsl(var(--chart-2))',
  				'3': 'hsl(var(--chart-3))',
  				'4': 'hsl(var(--chart-4))',
  				'5': 'hsl(var(--chart-5))'
  			},
  			sidebar: {
  				DEFAULT: 'hsl(var(--sidebar-background))',
  				foreground: 'hsl(var(--sidebar-foreground))',
  				primary: 'hsl(var(--sidebar-primary))',
  				'primary-foreground': 'hsl(var(--sidebar-primary-foreground))',
  				accent: 'hsl(var(--sidebar-accent))',
  				'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
  				border: 'hsl(var(--sidebar-border))',
  				ring: 'hsl(var(--sidebar-ring))'
  			},

  			/* Brand shorthands */
  			ink: {
  				DEFAULT: '#21201C',
  				soft: '#35332D',
  				muted: '#6F6C63'
  			},
  			cream: '#FAF9F2',
  			paper: '#FDFCF7',

  			/* Grey families -> one warm ramp */
  			gray: warm,
  			slate: warm,
  			zinc: warm,
  			neutral: warm,
  			stone: warm,

  			/* Cool accents -> warm monochrome */
  			blue: warm,
  			indigo: warm,
  			violet: warm,
  			purple: warm,
  			fuchsia: warm,
  			sky: warm,
  			cyan: warm,
  			teal: warm,

  			/* Status colours, warmed */
  			red: brick,
  			rose: brick,
  			pink: brick,
  			amber: ochre,
  			yellow: ochre,
  			orange: clay,
  			green: sage,
  			emerald: sage,
  			lime: sage
  		},
  		keyframes: {
  			'accordion-down': {
  				from: {
  					height: '0'
  				},
  				to: {
  					height: 'var(--radix-accordion-content-height)'
  				}
  			},
  			'accordion-up': {
  				from: {
  					height: 'var(--radix-accordion-content-height)'
  				},
  				to: {
  					height: '0'
  				}
  			}
  		},
  		animation: {
  			'accordion-down': 'accordion-down 0.2s ease-out',
  			'accordion-up': 'accordion-up 0.2s ease-out'
  		}
  	}
  },
  plugins: [require("tailwindcss-animate")],
}
