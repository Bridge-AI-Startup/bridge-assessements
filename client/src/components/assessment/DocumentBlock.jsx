import React, { useState, useRef, useEffect } from "react";
import { motion } from "framer-motion";
import { Pencil, Sparkles, GripVertical, Trash2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export default function DocumentBlock({
  title,
  icon: Icon,
  children,
  isActive,
  isHighlighted,
  onSelect,
  onAddToContext,
  isInContext,
  onEdit,
  editValue,
  type = "default",
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState("");
  const textareaRef = useRef(null);

  // Auto-resize textarea to fit content
  useEffect(() => {
    if (isEditing && textareaRef.current) {
      // Use setTimeout to ensure DOM is ready
      setTimeout(() => {
        const textarea = textareaRef.current;
        if (textarea) {
          // Reset height to auto to get the correct scrollHeight
          textarea.style.height = "auto";
          // Set height to scrollHeight to fit all content
          textarea.style.height = `${textarea.scrollHeight}px`;
        }
      }, 0);
    }
  }, [isEditing, editText]);

  const handleStartEdit = (e) => {
    e.stopPropagation();
    setEditText(editValue || "");
    setIsEditing(true);
  };

  const handleTextChange = (e) => {
    setEditText(e.target.value);
    // Auto-resize on input
    const textarea = e.target;
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  };

  const handleSave = async (e) => {
    e.stopPropagation();
    if (onEdit) {
      await onEdit(editText);
    }
    setIsEditing(false);
  };

  const handleCancel = (e) => {
    e.stopPropagation();
    setIsEditing(false);
  };

  return (
    <motion.div
      onClick={onSelect}
      className={`bg-white rounded-xl border transition-all duration-200 cursor-pointer ${
        isActive
          ? "border-[#1E3A8A] shadow-sm"
          : "border-gray-200 hover:border-gray-300"
      } ${
        isHighlighted
          ? "ring-4 ring-yellow-400 ring-opacity-75 shadow-lg border-yellow-400"
          : ""
      }`}
      animate={isHighlighted ? { scale: [1, 1.02, 1] } : {}}
      transition={{ duration: 0.3 }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center">
            <Icon className="w-4 h-4 text-gray-600" />
          </div>
          <span className="font-medium text-gray-900">{title}</span>
        </div>
        <div className="flex items-center gap-1">
          {onEdit && (
            <Button
              variant="ghost"
              size="sm"
              onClick={isEditing ? handleCancel : handleStartEdit}
              className="h-8 px-2.5 text-gray-500 hover:text-gray-700"
            >
              <Pencil className="w-3.5 h-3.5 mr-1.5" />
              {isEditing ? "Cancel" : "Edit"}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              onAddToContext?.();
            }}
            className={`h-8 px-2.5 ${
              isInContext
                ? "text-green-600 hover:text-green-700 hover:bg-green-50"
                : "text-[#1E3A8A] hover:text-[#1E3A8A] hover:bg-blue-50"
            }`}
          >
            <Plus
              className={`w-3.5 h-3.5 mr-1.5 ${
                isInContext ? "rotate-45" : ""
              } transition-transform`}
            />
            {isInContext ? "Editable" : "Restrict edits to this"}
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="px-5 py-4">
        {isEditing ? (
          <div className="space-y-3">
            <Textarea
              ref={textareaRef}
              value={editText}
              onChange={handleTextChange}
              onClick={(e) => e.stopPropagation()}
              className="min-h-[100px] text-gray-700 resize-none overflow-hidden"
              style={{ height: "auto" }}
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={handleCancel}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleSave}
                className="bg-[#1E3A8A] hover:bg-[#152a66]"
              >
                Save
              </Button>
            </div>
          </div>
        ) : (
          <div
            onClick={(e) => {
              e.stopPropagation();
              if (onEdit) {
                handleStartEdit(e);
              }
            }}
            className="cursor-text hover:bg-gray-50 -mx-5 -my-4 px-5 py-4 rounded transition-colors"
          >
            {children}
          </div>
        )}
      </div>
    </motion.div>
  );
}

export function DeliverableItem({ text, index, onEdit, onDelete }) {
  const [isHovered, setIsHovered] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(text);

  const handleSave = () => {
    onEdit?.(editText);
    setIsEditing(false);
  };

  if (isEditing) {
    return (
      <div className="flex items-start gap-3 py-2.5 px-3 -mx-3 rounded-lg bg-gray-50">
        <span className="w-6 h-6 rounded-full bg-gray-100 text-gray-500 text-xs flex items-center justify-center flex-shrink-0 mt-1">
          {index + 1}
        </span>
        <input
          type="text"
          value={editText}
          onChange={(e) => setEditText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSave()}
          className="flex-1 text-gray-700 bg-white border border-gray-200 rounded px-2 py-1 text-sm"
          autoFocus
        />
        <button
          onClick={handleSave}
          className="p-1.5 text-green-600 hover:text-green-700 rounded"
        >
          Save
        </button>
        <button
          onClick={() => setIsEditing(false)}
          className="p-1.5 text-gray-400 hover:text-gray-600 rounded"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div
      className="flex items-start gap-3 py-2.5 px-3 -mx-3 rounded-lg hover:bg-gray-50 group transition-colors"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <GripVertical className="w-4 h-4 text-gray-300 mt-0.5 cursor-grab opacity-0 group-hover:opacity-100 transition-opacity" />
      <span className="w-6 h-6 rounded-full bg-gray-100 text-gray-500 text-xs flex items-center justify-center flex-shrink-0">
        {index + 1}
      </span>
      <p className="flex-1 text-gray-700 leading-relaxed">{text}</p>
      {isHovered && (
        <div className="flex items-center gap-1">
          <button
            onClick={() => setIsEditing(true)}
            className="p-1.5 text-gray-400 hover:text-[#1E3A8A] rounded transition-colors"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>

          <button
            className="p-1.5 text-gray-400 hover:text-red-500 rounded transition-colors"
            onClick={onDelete}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

export function RubricItem({ criteria, weight, onEdit, onDelete }) {
  const [isEditing, setIsEditing] = useState(false);
  const [editCriteria, setEditCriteria] = useState(criteria);
  const [editWeight, setEditWeight] = useState(weight);

  const handleSave = () => {
    onEdit?.(editCriteria, editWeight);
    setIsEditing(false);
  };

  if (isEditing) {
    return (
      <div className="flex items-center gap-3 py-2.5 px-3 -mx-3 rounded-lg bg-gray-50">
        <div className="w-2 h-2 rounded-full bg-[#1E3A8A]" />
        <input
          type="text"
          value={editCriteria}
          onChange={(e) => setEditCriteria(e.target.value)}
          className="flex-1 text-gray-700 bg-white border border-gray-200 rounded px-2 py-1 text-sm"
          placeholder="Criteria"
          autoFocus
        />
        <input
          type="text"
          value={editWeight}
          onChange={(e) => setEditWeight(e.target.value)}
          className="w-16 text-gray-700 bg-white border border-gray-200 rounded px-2 py-1 text-sm text-center"
          placeholder="25%"
        />
        <button
          onClick={handleSave}
          className="text-xs text-green-600 hover:text-green-700"
        >
          Save
        </button>
        <button
          onClick={() => setIsEditing(false)}
          className="text-xs text-gray-400 hover:text-gray-600"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between py-2.5 px-3 -mx-3 rounded-lg hover:bg-gray-50 group transition-colors">
      <div className="flex items-center gap-3">
        <div className="w-2 h-2 rounded-full bg-[#1E3A8A]" />
        <span className="text-gray-700">{criteria}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-sm text-gray-400">{weight}</span>
        <button
          onClick={() => setIsEditing(true)}
          className="opacity-0 group-hover:opacity-100 p-1.5 text-gray-400 hover:text-[#1E3A8A] rounded transition-colors"
        >
          <Pencil className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={onDelete}
          className="opacity-0 group-hover:opacity-100 p-1.5 text-gray-400 hover:text-red-500 rounded transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

export function TestCaseItem({ name, type, points, onEdit, onDelete }) {
  const [isHovered, setIsHovered] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(name);
  const [editType, setEditType] = useState(type);
  const [editPoints, setEditPoints] = useState(points);

  const typeColors = {
    unit: "bg-green-100 text-green-700",
    integration: "bg-blue-100 text-blue-700",
    e2e: "bg-purple-100 text-purple-700",
  };

  const handleSave = () => {
    onEdit?.(editName, editType, Number(editPoints));
    setIsEditing(false);
  };

  if (isEditing) {
    return (
      <div className="flex items-center gap-3 py-2.5 px-3 -mx-3 rounded-lg bg-gray-50">
        <select
          value={editType}
          onChange={(e) => setEditType(e.target.value)}
          className="text-xs bg-white border border-gray-200 rounded px-2 py-1"
        >
          <option value="unit">unit</option>
          <option value="integration">integration</option>
          <option value="e2e">e2e</option>
        </select>
        <input
          type="text"
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          className="flex-1 text-gray-700 bg-white border border-gray-200 rounded px-2 py-1 text-sm"
          placeholder="Test case name"
          autoFocus
        />
        <input
          type="number"
          value={editPoints}
          onChange={(e) => setEditPoints(e.target.value)}
          className="w-16 text-gray-700 bg-white border border-gray-200 rounded px-2 py-1 text-sm text-center"
          placeholder="10"
        />
        <button
          onClick={handleSave}
          className="text-xs text-green-600 hover:text-green-700"
        >
          Save
        </button>
        <button
          onClick={() => setIsEditing(false)}
          className="text-xs text-gray-400 hover:text-gray-600"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div
      className="flex items-center justify-between py-2.5 px-3 -mx-3 rounded-lg hover:bg-gray-50 group transition-colors"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div className="flex items-center gap-3">
        <span
          className={`px-2 py-0.5 text-xs rounded-full ${
            typeColors[type] || "bg-gray-100 text-gray-600"
          }`}
        >
          {type}
        </span>
        <span className="text-gray-700">{name}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-sm text-gray-400">{points} pts</span>
        {isHovered && (
          <div className="flex items-center gap-1">
            <button
              onClick={() => setIsEditing(true)}
              className="p-1.5 text-gray-400 hover:text-[#1E3A8A] rounded transition-colors"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
            <button
              className="p-1.5 text-gray-400 hover:text-red-500 rounded transition-colors"
              onClick={onDelete}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
