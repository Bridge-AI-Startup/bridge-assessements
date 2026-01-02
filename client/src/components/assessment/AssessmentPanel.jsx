import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, ChevronUp, Pencil, Check, X } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';

export default function AssessmentPanel({ 
  title, 
  icon: Icon, 
  content, 
  isHighlighted, 
  onEdit,
  type = 'text' // 'text', 'list', 'toggles'
}) {
  const [isOpen, setIsOpen] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [showHighlight, setShowHighlight] = useState(false);

  useEffect(() => {
    if (isHighlighted) {
      setShowHighlight(true);
      const timer = setTimeout(() => setShowHighlight(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [isHighlighted, content]);

  const handleEdit = () => {
    setEditValue(typeof content === 'string' ? content : JSON.stringify(content, null, 2));
    setIsEditing(true);
  };

  const handleSave = () => {
    onEdit?.(editValue);
    setIsEditing(false);
  };

  const handleCancel = () => {
    setIsEditing(false);
  };

  const renderContent = () => {
    if (isEditing) {
      return (
        <div className="space-y-3">
          <Textarea
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            className="min-h-[120px] text-sm"
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={handleCancel}>
              <X className="w-4 h-4 mr-1" /> Cancel
            </Button>
            <Button size="sm" onClick={handleSave} className="bg-[#1E3A8A] text-white hover:bg-[#152a66]">
              <Check className="w-4 h-4 mr-1" /> Save
            </Button>
          </div>
        </div>
      );
    }

    if (type === 'list' && Array.isArray(content)) {
      return (
        <ul className="space-y-2">
          {content.map((item, index) => (
            <motion.li 
              key={index}
              className={`flex items-start gap-3 p-2 rounded-lg transition-colors duration-300 ${showHighlight ? 'bg-[#FFFF00]/30' : ''}`}
            >
              <span className="w-6 h-6 rounded-md bg-gray-100 flex items-center justify-center flex-shrink-0 text-xs font-medium text-gray-600">
                {index + 1}
              </span>
              <span className="text-gray-700">{item}</span>
            </motion.li>
          ))}
        </ul>
      );
    }


    if (type === 'toggles' && typeof content === 'object') {
      return (
        <div className="space-y-3">
          {Object.entries(content).map(([key, value]) => (
            <motion.div 
              key={key}
              className={`flex items-center justify-between p-3 rounded-lg border border-gray-100 transition-colors duration-300 ${showHighlight ? 'bg-[#FFFF00]/30' : 'bg-gray-50'}`}
            >
              <span className="text-gray-700">{key}</span>
              <div className={`w-10 h-6 rounded-full ${value ? 'bg-[#1E3A8A]' : 'bg-gray-300'} relative cursor-pointer transition-colors`}>
                <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${value ? 'right-1' : 'left-1'}`} />
              </div>
            </motion.div>
          ))}
        </div>
      );
    }

    return (
      <motion.p 
        className={`text-gray-700 leading-relaxed p-2 rounded-lg transition-colors duration-300 ${showHighlight ? 'bg-[#FFFF00]/30' : ''}`}
      >
        {content}
      </motion.p>
    );
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white rounded-2xl shadow-[0_2px_20px_rgba(0,0,0,0.04)] border border-gray-100 overflow-hidden"
    >
      {/* Header */}
      <div 
        className="px-6 py-4 flex items-center justify-between cursor-pointer hover:bg-gray-50/50 transition-colors"
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[#1E3A8A]/10 flex items-center justify-center">
            <Icon className="w-4 h-4 text-[#1E3A8A]" />
          </div>
          <h3 className="font-semibold text-gray-900">{title}</h3>
        </div>
        <div className="flex items-center gap-2">
          {!isEditing && (
            <button 
              onClick={(e) => { e.stopPropagation(); handleEdit(); }}
              className="p-2 text-gray-400 hover:text-[#1E3A8A] transition-colors"
            >
              <Pencil className="w-4 h-4" />
            </button>
          )}
          {isOpen ? (
            <ChevronUp className="w-5 h-5 text-gray-400" />
          ) : (
            <ChevronDown className="w-5 h-5 text-gray-400" />
          )}
        </div>
      </div>

      {/* Content */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-6 pb-5">
              {renderContent()}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}