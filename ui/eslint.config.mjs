import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const config = [
  ...nextVitals,
  ...nextTs,
  { ignores: [".next/**", "out/**", "node_modules/**", "next-env.d.ts"] },
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-properties": [
        "error",
        { object: "Math", property: "random", message: "No fake data: Math.random is banned in src/." },
      ],
    },
  },
];

export default config;
