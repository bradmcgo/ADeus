import { serve } from "https://deno.land/std@0.170.0/http/server.ts";
import OpenAI, { toFile } from "https://deno.land/x/openai@v4.26.0/mod.ts";
import { multiParser } from 'https://deno.land/x/multiparser@0.114.0/mod.ts';
import { corsHeaders } from "../common/cors.ts";
import { supabaseClient } from "../common/supabaseClient.ts";


const processAudio = async (req: Request) => {
  
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const supabase = supabaseClient(req);
  const openaiClient = new OpenAI({
    apiKey: "OPENAI_API_KEY",
  });
  
  const contentType = req.headers.get('Content-Type') || '';
    let arrayBuffer: ArrayBuffer;
    let filenameTimestamp = `audio_${Date.now()}.wav`;

    if (contentType.includes('multipart/form-data')) {
        const form = await multiParser(req);
        if (!form || !form.files || !form.files.file) {
            return new Response('File not found in form', {
                status: 400,
                headers: corsHeaders,
            });
        }
        console.log('Form:', form);
        const file = form.files.file;
        arrayBuffer = file.content.buffer;
        console.log("array buffer:", arrayBuffer)
        filenameTimestamp = file.filename || filenameTimestamp;
      } else {
        arrayBuffer = await req.arrayBuffer();
      }

      let transcript: string;
      try {
        const filenameTimestamp = `adeus_wav_${Date.now()}.wav`;
        const wavFile = await toFile(arrayBuffer, filenameTimestamp);
        
        // Directly use the arrayBuffer to create a Blob
        const audioBlob = new Blob([arrayBuffer], { type: "audio/wav" });

        // Prepare the FormData with the Blob
        let formData = new FormData();
        formData.append("file", audioBlob, filenameTimestamp);
      
    const response = await fetch(Deno.env.get("WHISPER_BASE_URL"), {
      method: "POST",
      body: formData,
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    console.log("Transcript data:", data.transcription);
    transcript =  data.transcription;
    

      // const transcriptResponse = await openaiClient.audio.transcriptions.create({
        //   file: await toFile(wavFile, filenameTimestamp),
        //   model: "whisper-1",
        //   prompt:
        //     'Listen to the entire audio file, if no audio is detected then respond with "None" ', // These types of prompts dont work well with Whisper -- https://platform.openai.com/docs/guides/speech-to-text/prompting
        // });
        // console.log("filenameTimestamp:", filenameTimestamp)
        // console.log("wavFile:", wavFile)
        // console.log("file:", await toFile(wavFile, filenameTimestamp))
        // // transcript = transcriptResponse.text;
        let transcriptLowered = transcript.toLowerCase();
        
        if (
            transcript == "None" ||
            transcript == "" ||
            transcript == null ||
            (transcriptLowered.includes("thank") &&
              transcriptLowered.includes("watch"))
          ) {
              return new Response(JSON.stringify({ message: "No transcript found." }), {
                  headers: { ...corsHeaders, "Content-Type": "application/json" },
                  status: 200,
                });
              }

    const { data: unprocessedRecords, error: fetchError } = await supabase
    .from('records')
    .select('raw_text, id')
    .eq('processed', false)
    .order('created_at', { ascending: true })
    .limit(4);
    
    if (fetchError) {
      console.error("Error fetching records:", fetchError);
      return new Response(JSON.stringify({ message: "Error fetching records." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      });
    }
    
    const insertResponse = await supabase
    .from("records")
    .insert([{ raw_text: transcript, processed: false }])
    .select();
    
    if (insertResponse.error) {
    console.error("Error inserting record:", insertResponse.error);
    return new Response(JSON.stringify({ message: "Error inserting record." }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
  
  const currentTranscript = {
    raw_text: transcript,
    id: insertResponse.data[0].id,
  };
  
  console.log("unprocessedRecords", unprocessedRecords)
  console.log("currentTranscript:", currentTranscript)

  const allRecordsToProcess = [...unprocessedRecords, currentTranscript];
  if (allRecordsToProcess.length === 5) {
    console.log("Processing new transcript with 4 unprocessed records...");
    let concatenatedTranscripts = unprocessedRecords
    .map((record: any) => record.raw_text)
    .join(" ");
    
    interface llmClient {
      chat: {
        completions: {
          create: (params: { model: string; messages: Message[]; stream?: boolean; response_format: any }) => AsyncIterable<{ choices: Choice[] }>;
        };
      };
      embeddings: {
        create: (params: { model: string; input: string }) => Promise<{ data: any[] }>;
      };
    }
    
    interface SearchResult {
      id: number;
      raw_text: string;
      similarity: number;
    }
    
    interface Message {
      role: string;
      content: string;
    }
    
    interface Choice {
      delta: {
        content: string;
      };
    }
    
    // Current models available
    type ModelName = "nousresearch/nous-capybara-34b" | "mistral" | "gpt-4-0125-preview";
    
    const useOpenRouter = Boolean(Deno.env.get("OPENROUTER_API_KEY")); // Use OpenRouter if API key is available
    const useOllama = Boolean(Deno.env.get("OLLAMA_BASE_URL")); // Use Ollama if OLLAMA_BASE_URL is available
    
    
    let client: llmClient;
    let modelName: ModelName;
    
    if (useOpenRouter) {
      client = new OpenAI({
        baseURL: "https://openrouter.ai/api/v1",
        apiKey: Deno.env.get("OPENROUTER_API_KEY"),
      });
      modelName = "nousresearch/nous-capybara-34b";
    } else if (useOllama) {
      client = new OpenAI({
        baseURL: Deno.env.get("OLLAMA_BASE_URL"),
        apiKey: "ollama",
      });
      modelName = 'mistral'; 
    } 
    else {
      client = openaiClient;
      modelName = 'gpt-4-0125-preview';
    }
    
    
    const response = await client.chat.completions.create({
      model: modelName,
      messages: [
        {
          role: 'system',
          content: `
          These transcripts contain information about your user. 
          Your task is to organize the information in a way that makes sense to you.
          Your response must be in json format with the three following keys: "summary", "topics".
          `,
        },
        {
          role: 'user',
          content: `${concatenatedTranscripts}\n\nGiven the information about the user, provide a summary, and the topics discussed.\n
          *** Summary must be a brief overview of the transcript.\n\n
          *** Topics must be a list of topics that were discussed in the transcript, include topics not mentioned but that relate to the topics discussed.\n\n
          `,
        },
      ],
        response_format: { type: 'json_object' },
      });
      console.log("response: ", response)
      
      const responseData = JSON.parse(response.choices[0].message.content);
      
      const { summary, topics } = responseData;
      
      console.log("allRecordsToProcess:", allRecordsToProcess)

      allRecordsToProcess.forEach(async (record: any) => {
        const flattenedData: string = `Raw Text: ${record.raw_text}, This is an summary of the broader conversation so you have more context ${summary}, and Topics pertaining to the conversation ${topics}`;
        console.log("flattenedData:", flattenedData)

        let embeddings
        try {
            const response = await fetch(Deno.env.get("EMBEDDINGS_BASE_URL"), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ flattenedData })
            });
            
            if (!response.ok) {
                throw new Error('Failed to fetch embeddings');
            }
    
            const data = await response.json();
            console.log(data.embeddings);
            embeddings = data.embeddings
        } catch (error) {
            console.error('Error:', error);
        }

        // const embeddingsReponse = await openaiClient.embeddings.create({
        //   model: 'text-embedding-3-small',
        //   input: flattenedData,
        // })
        
        // const embeddings = embeddingsReponse.data[0].embedding;
        // console.log("Embeddings:", embeddings);
        
        const updateResponse = await supabase
        .from('records')
        .update({ processed: true, summary, topics, embeddings })
        .eq('id', record.id);
        
        if (updateResponse.error) {
          console.error("Error updating record:", updateResponse.error);
          return new Response(JSON.stringify({ message: "Error updating record." }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 500,
          });
        }
      });
    } 
    
  } catch (error) {
    console.error("Transcription error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
  
  return new Response(
    JSON.stringify({ message: "Audio transcribed successfully.", transcript }),
    {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    }
    );
  };
  
  serve(processAudio);