import { motion } from 'framer-motion';

const presets = [
  { label: "Frontend intern (React)", value: "We're hiring a frontend intern proficient in React to build responsive user interfaces and collaborate with our design team on new features..." },
  { label: "Backend intern (Node)", value: "We're looking for a backend intern who knows Node.js and PostgreSQL to build internal APIs and data pipelines. They'll work on performance and reliability..." },
  { label: "Full stack MERN + Langchain", value: "We're seeking a full-stack MERN developer skilled in MongoDB, Express, React, and Node.js, with experience in Langchain to build end-to-end web applications with AI capabilities..." }
];

export default function PresetPills({ onSelect, selectedPreset }) {
  return (
    <div className="flex flex-wrap gap-2">
      {presets.map((preset, index) => (
        <motion.button
          key={index}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => onSelect(preset.value)}
          className={`px-4 py-2 text-sm rounded-full border transition-all duration-200 ${
            selectedPreset === preset.value
              ? 'bg-[#1E3A8A] text-white border-[#1E3A8A]'
              : 'bg-white text-gray-600 border-gray-200 hover:border-[#1E3A8A] hover:text-[#1E3A8A]'
          }`}
        >
          {preset.label}
        </motion.button>
      ))}
    </div>
  );
}