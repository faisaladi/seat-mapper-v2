'use client';
import React from 'react';
import { Copy, Download } from 'lucide-react';
import type { SeatData } from '../model/types';

// Export modal: pretty-printed JSON with copy-all and download actions.

interface JsonOutputModalProps {
  seatData: SeatData;
  onClose: () => void;
  onCopy: () => void;
  onDownload: () => void;
}

const JsonOutputModal: React.FC<JsonOutputModalProps> = ({ seatData, onClose, onCopy, onDownload }) => {
  const jsonString = JSON.stringify(seatData, null, 2);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg w-full max-w-6xl h-5/6 flex flex-col">
        <div className="flex items-center justify-between p-4 border-b bg-gray-50">
          <div>
            <h3 className="text-lg font-semibold">JSON Output</h3>
            <p className="text-sm text-gray-600">Select all text (Ctrl+A) and copy (Ctrl+C)</p>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={onDownload}
              className="flex items-center px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
            >
              <Download className="w-4 h-4 mr-2" />
              Download JSON
            </button>
            <button
              onClick={onCopy}
              className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Copy className="w-4 h-4 mr-2" />
              Copy All
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
        <div className="flex-1 p-4 overflow-hidden">
          <div className="h-full border rounded-lg overflow-hidden">
            <textarea
              value={jsonString}
              readOnly
              className="w-full h-full font-mono text-sm p-4 resize-none bg-gray-50 border-0 focus:outline-none"
              style={{
                minHeight: '100%',
                fontFamily: 'Monaco, Menlo, Consolas, "Courier New", monospace',
                fontSize: '12px',
                lineHeight: '1.4'
              }}
              onFocus={(e) => e.target.select()}
            />
          </div>
        </div>
        <div className="p-4 border-t bg-gray-50">
          <div className="flex items-center justify-between text-sm text-gray-600">
            <span>
              Lines: {jsonString.split('\n').length} |
              Characters: {jsonString.length.toLocaleString()}
            </span>
            <span className="text-blue-600 font-medium">
              💡 Tip: Click in the text area and press Ctrl+A to select all, then Ctrl+C to copy
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default JsonOutputModal;
