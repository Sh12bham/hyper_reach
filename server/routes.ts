import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import multer from "multer";
import { parse } from "csv-parse/sync";
import fs from "fs";
import path from "path";
import os from "os";
import { stringify } from "csv-stringify/sync";
import { leadSchema, senderSchema, emailSettingsSchema } from "@shared/schema";
import type { Lead, GeneratedEmail } from "@shared/schema";
import { z } from "zod";

// Configure multer for file uploads
const upload = multer({ dest: os.tmpdir() });

export async function registerRoutes(app: Express): Promise<Server> {
  // Sample CSV download endpoint
  app.get("/api/sample-csv", (req: Request, res: Response) => {
    const sampleData = [
      ["NAME", "COMPANY NAME", "PRODUCT DESCRIPTION"],
      ["Jane Smith", "XYZ Corp", "Software Development"],
      ["John Doe", "ABC Inc", "Digital Marketing"],
      ["Sarah Johnson", "123 Solutions", "Cloud Services"],
    ];

    const csvContent = stringify(sampleData);
    
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=sample_leads.csv");
    res.send(csvContent);
  });

  // CSV upload and parsing endpoint
  app.post("/api/upload-csv", upload.single("file"), (req: Request, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      // Read the uploaded file
      const fileContent = fs.readFileSync(req.file.path, "utf8");
      
      // Parse CSV
      const records = parse(fileContent, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      });

      // Map CSV records to Lead objects
      const leads: Lead[] = records.map((record: any) => {
        return {
          name: record.NAME || "",
          companyName: record["COMPANY NAME"] || "",
          productDescription: record["PRODUCT DESCRIPTION"] || "",
          email: record.EMAIL || "",
        };
      });

      // Validate each lead
      const validatedLeads: Lead[] = [];
      for (const lead of leads) {
        try {
          const validLead = leadSchema.parse(lead);
          validatedLeads.push(validLead);
        } catch (error) {
          console.error("Invalid lead data:", error);
          // Skip invalid entries
        }
      }

      // Clean up the temporary file
      fs.unlinkSync(req.file.path);

      return res.status(200).json({
        message: "CSV processed successfully",
        leads: validatedLeads,
      });
    } catch (error) {
      console.error("Error processing CSV:", error);
      return res.status(500).json({
        message: "Failed to process CSV file",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // Email generation endpoint
  app.post("/api/generate-emails", async (req: Request, res: Response) => {
    try {
      // Validate request body
      const schema = z.object({
        sender: senderSchema,
        emailSettings: emailSettingsSchema,
        leads: z.array(leadSchema),
      });

      const validatedData = schema.parse(req.body);
      
      // OpenRouter API integration
      const openRouterApiKey = process.env.OPENROUTER_API_KEY;
      
      // Check if API key is available and clean it
      if (!openRouterApiKey) {
        return res.status(500).json({
          message: "Failed to generate emails",
          error: "OPENROUTER_API_KEY environment variable is not set"
        });
      }

      // Clean the API key once at the start
      const cleanApiKey = openRouterApiKey.trim().replace(/^["']|["']$/g, '');
      
      // Generate emails for each lead
      const generatedEmails: GeneratedEmail[] = [];
      
      // Filter out leads with missing required data
      const validLeads = validatedData.leads.filter(lead => 
        lead.name && lead.name.trim() !== '' && 
        lead.companyName && lead.companyName.trim() !== ''
      );
      
      if (validLeads.length === 0) {
        return res.status(400).json({
          message: "No valid leads provided",
          error: "All leads must have a name and company name"
        });
      }
      
      for (const lead of validLeads) {
        // Determine word count range based on email size setting
        let wordCountPrompt = "";
        if (validatedData.emailSettings.size === "Short (50-100 words)") {
          wordCountPrompt = "Keep the email between 50-100 words.";
        } else if (validatedData.emailSettings.size === "Medium (100-200 words)") {
          wordCountPrompt = "Keep the email between 100-200 words.";
        } else if (validatedData.emailSettings.size === "Long (200-300 words)") {
          wordCountPrompt = "Keep the email between 200-300 words.";
        } else if (validatedData.emailSettings.size === "Custom" && validatedData.emailSettings.customWordCount) {
          wordCountPrompt = `Keep the email around ${validatedData.emailSettings.customWordCount} words.`;
        }

        // Build the prompt for the AI
        let promptContent = `
        You are an expert email copywriter. Write a highly personalized sales email using the EXACT recipient data. NEVER use placeholders like [Recipient Name] or [Company]. The email MUST look like it was written specifically for this exact recipient:

        SENDER INFORMATION:
        - Name: ${validatedData.sender.name}
        - Position: ${validatedData.sender.position || 'Sales Representative'}
        - Company: ${validatedData.sender.company}
        - Product/Service: ${validatedData.sender.productDescription}
        - Email: ${validatedData.sender.email || ''}
        - Phone: ${validatedData.sender.phone || ''}

        RECIPIENT INFORMATION:
        - Name: ${lead.name}
        - Company: ${lead.companyName}
        ${lead.productDescription ? `- Product/Service: ${lead.productDescription}` : ''}
        ${lead.email ? `- Email: ${lead.email}` : ''}

        INSTRUCTIONS:
        - Use a ${validatedData.emailSettings.tone.toLowerCase()} tone
        - Create both a subject line and email body
        - Format your response as: "SUBJECT: <subject line>\n\nBODY:\n<email body>"
        - ${wordCountPrompt}
        - The subject line MUST explicitly mention the recipient's product: "${lead.productDescription || "their business needs"}"
        - In the email, ALWAYS use the exact name "${lead.name}" directly - DO NOT use placeholders like [Recipient's Name]
        - In the email, ALWAYS use the exact company name "${lead.companyName}" directly - DO NOT use placeholders like [Recipient's Company]
        - IMPORTANT: Do not use ANY placeholders or brackets like [Name] or [Company Name] - use the actual data
        - Make the email highly personalized to the recipient's specific needs
        - Include a professional signature at the end with sender's exact contact details
        - For the signature, use ONLY the information provided (name, position, company, etc.)
        - If email or phone is blank, simply omit them from the signature instead of using placeholders
        ${validatedData.emailSettings.customPrompt ? `- Additional instructions: ${validatedData.emailSettings.customPrompt}` : ''}
        `;

        console.log(`Making API call to OpenRouter for lead: ${lead.name}`);
        if (openRouterApiKey) {
          console.log(`Using API key starting with: ${openRouterApiKey.substring(0, 10)}...`);
        } else {
          console.error("OPENROUTER_API_KEY environment variable is not set!");
          throw new Error("OPENROUTER_API_KEY environment variable is not set");
        }
        
        // Make API call to OpenRouter
        const requestBody = {
          model: "qwen/qwen2.5-vl-32b-instruct:free",
          messages: [
            { role: "user", content: promptContent }
          ],
          temperature: 0.7,
          max_tokens: 1000
        };
        
        console.log("Request payload:", JSON.stringify(requestBody, null, 2));
        
        let subject = "";
        let body = "";
        
        try {
          const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${openRouterApiKey}`,
              "HTTP-Referer": process.env.REPLIT_DOMAINS || "https://localhost:5000",
              "X-Title": "AI Email Generator"
            },
            body: JSON.stringify(requestBody)
          });

          console.log(`OpenRouter API response status: ${response.status}`);
          
          if (!response.ok) {
            const errorText = await response.text();
            console.error("OpenRouter API error:", errorText);
            throw new Error(`OpenRouter API error: ${errorText}`);
          }

          const data = await response.json();
          console.log("OpenRouter API response:", JSON.stringify(data, null, 2));
          
          // Parse the AI response to extract subject and body
          const aiResponse = data.choices[0].message.content;
          console.log(`Raw AI response for lead ${lead.name}:`, aiResponse);
          
          const subjectMatch = aiResponse.match(/SUBJECT:\s*(.*?)(?:\n|$)/i);
          if (subjectMatch && subjectMatch[1]) {
            subject = subjectMatch[1].trim();
            console.log(`Extracted subject: "${subject}"`);
          } else {
            console.warn("Failed to extract subject from AI response");
          }
          
          const bodyMatch = aiResponse.match(/BODY:\s*([\s\S]*)/i);
          if (bodyMatch && bodyMatch[1]) {
            body = bodyMatch[1].trim();
            console.log(`Extracted body (first 50 chars): "${body.substring(0, 50)}..."`);
          } else {
            console.warn("Failed to extract body from AI response");
          }
        } catch (err) {
          console.error("Error connecting to OpenRouter:", err);
          throw err;
        }
        
        // Log the email being added
        console.log(`Adding email for ${lead.name} - subject: "${subject}", body length: ${body.length}`);

        // Add generated email to results
        generatedEmails.push({
          lead,
          subject,
          body
        });
      }

      return res.status(200).json({
        message: "Emails generated successfully",
        emails: generatedEmails
      });
    } catch (error) {
      console.error("Error generating emails:", error);
      return res.status(500).json({
        message: "Failed to generate emails",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // Regenerate a single email
  app.post("/api/regenerate-email", async (req: Request, res: Response) => {
    try {
      // Validate request body
      const schema = z.object({
        sender: senderSchema,
        emailSettings: emailSettingsSchema,
        lead: leadSchema,
      });

      const validatedData = schema.parse(req.body);
      
      // Validate lead data 
      if (!validatedData.lead.name || validatedData.lead.name.trim() === '' || 
          !validatedData.lead.companyName || validatedData.lead.companyName.trim() === '') {
        return res.status(400).json({
          message: "Invalid lead data",
          error: "Lead must have a name and company name"
        });
      }
      
      // OpenRouter API integration
      const openRouterApiKey = process.env.OPENROUTER_API_KEY;
      if (!openRouterApiKey) {
        console.error("OPENROUTER_API_KEY environment variable is not set!");
        return res.status(500).json({
          message: "Failed to regenerate email",
          error: "OPENROUTER_API_KEY environment variable is not set"
        });
      }
      
      // Determine word count range based on email size setting
      let wordCountPrompt = "";
      if (validatedData.emailSettings.size === "Short (50-100 words)") {
        wordCountPrompt = "Keep the email between 50-100 words.";
      } else if (validatedData.emailSettings.size === "Medium (100-200 words)") {
        wordCountPrompt = "Keep the email between 100-200 words.";
      } else if (validatedData.emailSettings.size === "Long (200-300 words)") {
        wordCountPrompt = "Keep the email between 200-300 words.";
      } else if (validatedData.emailSettings.size === "Custom" && validatedData.emailSettings.customWordCount) {
        wordCountPrompt = `Keep the email around ${validatedData.emailSettings.customWordCount} words.`;
      }

      // Build the prompt for the AI
      let promptContent = `
      You are an expert email copywriter. Write a highly personalized sales email using the EXACT recipient data. NEVER use placeholders like [Recipient Name] or [Company]. The email MUST look like it was written specifically for this exact recipient:

      SENDER INFORMATION:
      - Name: ${validatedData.sender.name}
      - Position: ${validatedData.sender.position || 'Sales Representative'}
      - Company: ${validatedData.sender.company}
      - Product/Service: ${validatedData.sender.productDescription}
      - Email: ${validatedData.sender.email || ''}
      - Phone: ${validatedData.sender.phone || ''}

      RECIPIENT INFORMATION:
      - Name: ${validatedData.lead.name}
      - Company: ${validatedData.lead.companyName}
      ${validatedData.lead.productDescription ? `- Product/Service: ${validatedData.lead.productDescription}` : ''}
      ${validatedData.lead.email ? `- Email: ${validatedData.lead.email}` : ''}

      INSTRUCTIONS:
      - Use a ${validatedData.emailSettings.tone.toLowerCase()} tone
      - Create both a subject line and email body
      - Format your response as: "SUBJECT: <subject line>\n\nBODY:\n<email body>"
      - ${wordCountPrompt}
      - The subject line MUST explicitly mention the recipient's product: "${validatedData.lead.productDescription || "their business needs"}"
      - In the email, ALWAYS use the exact name "${validatedData.lead.name}" directly - DO NOT use placeholders like [Recipient's Name]
      - In the email, ALWAYS use the exact company name "${validatedData.lead.companyName}" directly - DO NOT use placeholders like [Recipient's Company]
      - IMPORTANT: Do not use ANY placeholders or brackets like [Name] or [Company Name] - use the actual data
      - Make the email highly personalized to the recipient's specific needs
      - Include a professional signature at the end with sender's exact contact details
      - For the signature, use ONLY the information provided (name, position, company, etc.)
      - If email or phone is blank, simply omit them from the signature instead of using placeholders
      ${validatedData.emailSettings.customPrompt ? `- Additional instructions: ${validatedData.emailSettings.customPrompt}` : ''}
      `;

      console.log(`Making API call to OpenRouter for lead: ${validatedData.lead.name}`);
      let cleanApiKey = "";
      if (openRouterApiKey) {
        cleanApiKey = openRouterApiKey.trim().replace(/^"|"$/g, '');
        console.log(`Using API key starting with: ${cleanApiKey.substring(0, 10)}...`);
      } else {
        console.error("OPENROUTER_API_KEY environment variable is not set!");
        throw new Error("OPENROUTER_API_KEY environment variable is not set");
      }
        
      // Make API call to OpenRouter
      const requestBody = {
        model: "qwen/qwen2.5-vl-32b-instruct:free",
        messages: [
          { role: "user", content: promptContent }
        ],
        temperature: 0.8,
        max_tokens: 1000
      };
      
      console.log("Request payload:", JSON.stringify(requestBody, null, 2));
        
      let subject = "";
      let body = "";
        
      try {
        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${cleanApiKey}`,
            "HTTP-Referer": process.env.REPLIT_DOMAINS || "https://localhost:5000",
            "X-Title": "AI Email Generator"
          },
          body: JSON.stringify(requestBody)
        });

        console.log(`OpenRouter API response status: ${response.status}`);
          
        if (!response.ok) {
          const errorText = await response.text();
          console.error("OpenRouter API error:", errorText);
          throw new Error(`OpenRouter API error: ${errorText}`);
        }

        const data = await response.json();
        console.log("OpenRouter API response:", JSON.stringify(data, null, 2));
          
        // Parse the AI response to extract subject and body
        const aiResponse = data.choices[0].message.content;
        console.log(`Raw AI response for lead ${validatedData.lead.name}:`, aiResponse);
          
        const subjectMatch = aiResponse.match(/SUBJECT:\s*(.*?)(?:\n|$)/i);
        if (subjectMatch && subjectMatch[1]) {
          subject = subjectMatch[1].trim();
          console.log(`Extracted subject: "${subject}"`);
        } else {
          console.warn("Failed to extract subject from AI response");
        }
          
        const bodyMatch = aiResponse.match(/BODY:\s*([\s\S]*)/i);
        if (bodyMatch && bodyMatch[1]) {
          body = bodyMatch[1].trim();
          console.log(`Extracted body (first 50 chars): "${body.substring(0, 50)}..."`);
        } else {
          console.warn("Failed to extract body from AI response");
        }
      } catch (err) {
        console.error("Error connecting to OpenRouter:", err);
        throw err;
      }
        
      console.log(`Generated email for ${validatedData.lead.name} - subject: "${subject}", body length: ${body.length}`);
      
      // No need to add placeholders

      return res.status(200).json({
        message: "Email regenerated successfully",
        email: {
          lead: validatedData.lead,
          subject,
          body
        }
      });
    } catch (error) {
      console.error("Error regenerating email:", error);
      return res.status(500).json({
        message: "Failed to regenerate email",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // Update an email
  app.post("/api/update-email", (req: Request, res: Response) => {
    try {
      // Validate request body
      const schema = z.object({
        lead: leadSchema,
        subject: z.string(),
        body: z.string(),
      });

      const validatedData = schema.parse(req.body);
      
      return res.status(200).json({
        message: "Email updated successfully",
        email: {
          lead: validatedData.lead,
          subject: validatedData.subject,
          body: validatedData.body
        }
      });
    } catch (error) {
      console.error("Error updating email:", error);
      return res.status(500).json({
        message: "Failed to update email",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // Email export endpoint
  app.post("/api/export-emails", (req: Request, res: Response) => {
    try {
      const { emails } = req.body;
      
      if (!Array.isArray(emails) || emails.length === 0) {
        return res.status(400).json({ message: "No emails to export" });
      }
      
      // Create CSV data
      const csvRows = [
        ["Recipient Name", "Recipient Company", "Subject", "Email Body"]
      ];
      
      emails.forEach((email: GeneratedEmail) => {
        csvRows.push([
          email.lead.name,
          email.lead.companyName,
          email.subject,
          email.body.replace(/\n/g, " ")
        ]);
      });
      
      const csvContent = stringify(csvRows);
      
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", "attachment; filename=personalized_emails.csv");
      res.send(csvContent);
    } catch (error) {
      console.error("Error exporting emails:", error);
      return res.status(500).json({
        message: "Failed to export emails",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
