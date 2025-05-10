import { useRef, useState } from "react";
import { Cloud, Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Lead, CSVRow } from "@/types";

interface LeadsUploadProps {
  onLeadsUploaded: (leads: Lead[]) => void;
}

export function LeadsUpload({ onLeadsUploaded }: LeadsUploadProps) {
  const [dragActive, setDragActive] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [isUploaded, setIsUploaded] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const handleFileUpload = async (file: File) => {
    // Check if file is CSV
    if (!file.name.endsWith('.csv') && file.type !== 'text/csv') {
      toast({
        title: "Invalid file format",
        description: "Please upload a CSV file",
        variant: "destructive",
      });
      return;
    }

    setFileName(file.name);

    // Create form data for upload
    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await fetch('http://localhost:5000/api/upload-csv', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error('Failed to upload file');
      }

      const data = await response.json();
      
      // Validate leads - require name and company name
      const validLeads = data.leads.filter((lead: Lead) => 
        lead.name && lead.name.trim() !== '' &&
        lead.companyName && lead.companyName.trim() !== ''
      );
      
      if (validLeads.length === 0) {
        toast({
          title: "No valid leads found",
          description: "Your CSV must contain at least one lead with both NAME and COMPANY NAME filled in.",
          variant: "destructive",
        });
        return;
      }
      
      if (validLeads.length < data.leads.length) {
        toast({
          title: "Some leads are incomplete",
          description: `Only ${validLeads.length} out of ${data.leads.length} leads had required NAME and COMPANY NAME data.`,
          variant: "destructive",
        });
      }
      
      onLeadsUploaded(validLeads);
      setIsUploaded(true);
      
      toast({
        title: "File uploaded successfully",
        description: `${validLeads.length} valid leads found in the CSV`,
      });
    } catch (error) {
      console.error('Error uploading file:', error);
      toast({
        title: "Upload failed",
        description: error instanceof Error ? error.message : "An unknown error occurred",
        variant: "destructive",
      });
    }
  };

  const downloadSampleCSV = async () => {
    try {
      const response = await apiRequest('GET', '/api/sample-csv', undefined);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'sample_leads.csv';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      toast({
        title: "Download failed",
        description: "Failed to download sample CSV file",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="bg-white rounded-md shadow-sm border border-gray-200 p-6">
      <h3 className="text-lg font-medium mb-2">Upload Leads Data</h3>
      <p className="text-sm text-gray-500 mb-6">Upload a CSV file with your leads information.</p>

      <div 
        className={cn(
          "border-2 border-dashed rounded-md p-8 mb-6 text-center cursor-pointer transition-all",
          dragActive ? "border-blue-500" : "border-gray-200",
          isUploaded ? "bg-gray-50" : ""
        )}
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragActive(false);
          if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            handleFileUpload(e.dataTransfer.files[0]);
          }
        }}
      >
        {isUploaded ? (
          <div className="flex flex-col items-center">
            <div className="h-12 w-12 rounded-full bg-green-100 flex items-center justify-center mb-4">
              <svg className="h-6 w-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-sm font-medium mb-1">File uploaded: {fileName}</p>
            <p className="text-xs text-gray-500">Click or drag to upload a different file</p>
          </div>
        ) : (
          <>
            <Cloud className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <p className="text-sm font-medium mb-1">Upload a file or drag and drop</p>
            <p className="text-xs text-gray-500">CSV file with lead details</p>
          </>
        )}
        
        <input 
          type="file" 
          className="hidden" 
          ref={fileInputRef}
          accept=".csv"
          onChange={(e) => {
            if (e.target.files && e.target.files[0]) {
              handleFileUpload(e.target.files[0]);
            }
          }}
        />
      </div>

      <div className="mb-6">
        <h4 className="text-sm font-medium mb-3">Required CSV format</h4>
        <div className="overflow-x-auto">
          <table className="min-w-full border border-gray-200">
            <thead>
              <tr className="bg-gray-50">
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-b border-gray-200">NAME</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-b border-gray-200">COMPANY NAME</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-b border-gray-200">PRODUCT DESCRIPTION</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="px-3 py-2 text-sm border-b border-gray-200">Jane Smith</td>
                <td className="px-3 py-2 text-sm border-b border-gray-200">XYZ Corp</td>
                <td className="px-3 py-2 text-sm border-b border-gray-200">Software Development</td>
              </tr>
            </tbody>
          </table>
        </div>
        
        <button 
          onClick={downloadSampleCSV}
          className="inline-flex items-center text-sm text-blue-600 mt-3"
        >
          <Download className="h-4 w-4 mr-1" />
          Download sample CSV
        </button>
      </div>
    </div>
  );
}

export default LeadsUpload;
