import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        platform: {
          youtube: "hsl(var(--platform-youtube))",
          tiktok: "hsl(var(--platform-tiktok))",
          instagram: "hsl(var(--platform-instagram))",
          linkedin: "hsl(var(--platform-linkedin))",
        },
        aca: {
          DEFAULT: "hsl(var(--aca-red))",
          light: "hsl(var(--aca-red-light))",
          dark: "hsl(var(--aca-red-dark))",
        },
        pro: {
          bg: "hsl(var(--pro-bg))",
          "bg-dark": "hsl(var(--pro-bg-dark))",
          border: "hsl(var(--pro-border))",
          "border-dark": "hsl(var(--pro-border-dark))",
          text: "hsl(var(--pro-text))",
          "text-dark": "hsl(var(--pro-text-dark))",
          accent: "hsl(var(--pro-accent))",
        },
        cta: {
          DEFAULT: "hsl(var(--cta))",
          foreground: "hsl(var(--cta-foreground))",
          hover: "hsl(var(--cta-hover))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      backgroundImage: {
        'gradient-purple': 'var(--gradient-purple)',
        'gradient-blue': 'var(--gradient-blue)',
        'gradient-pink': 'var(--gradient-pink)',
        'gradient-orange': 'var(--gradient-orange)',
        'gradient-red': 'var(--gradient-red)',
        'gradient-green': 'var(--gradient-green)',
        'gradient-aca': 'var(--gradient-aca)',
        'gradient-cta': 'var(--gradient-cta)',
      },
      keyframes: {
        "accordion-down": {
          from: {
            height: "0",
          },
          to: {
            height: "var(--radix-accordion-content-height)",
          },
        },
        "accordion-up": {
          from: {
            height: "var(--radix-accordion-content-height)",
          },
          to: {
            height: "0",
          },
        },
        "scale-in": {
          "0%": { transform: "scale(0.95)", opacity: "0" },
          "100%": { transform: "scale(1)", opacity: "1" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-1000px 0" },
          "100%": { backgroundPosition: "1000px 0" },
        },
        "glow-pulse": {
          "0%, 100%": {
            opacity: "1",
            boxShadow: "0 0 20px var(--glow-color, hsl(var(--primary)))",
          },
          "50%": {
            opacity: "0.8",
            boxShadow: "0 0 30px var(--glow-color, hsl(var(--primary)))",
          },
        },
        float: {
          "0%, 100%": { transform: "translateY(0px)" },
          "50%": { transform: "translateY(-10px)" },
        },
        "gradient-shift": {
          "0%, 100%": { backgroundPosition: "0% 50%" },
          "50%": { backgroundPosition: "100% 50%" },
        },
        "pulse-subtle": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.85" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "scale-in": "scale-in 0.2s ease-out",
        shimmer: "shimmer 3s linear infinite",
        "glow-pulse": "glow-pulse 2s ease-in-out infinite",
        float: "float 3s ease-in-out infinite",
        "gradient-shift": "gradient-shift 3s ease infinite",
        "pulse-subtle": "pulse-subtle 2s ease-in-out infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate"), require("@tailwindcss/typography")],
} satisfies Config;
