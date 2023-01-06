import {
  Form,
  ActionPanel,
  Action,
  showToast,
  getPreferenceValues,
  Toast,
  open,
  popToRoot,
  openExtensionPreferences,
  Detail,
} from "@raycast/api";
import { useEffect, useState } from "react";
import fs from "fs";
import https from "https";
import CloudConvert from "cloudconvert";
import cp from "child_process";

// get preferences
const apiKey = getPreferenceValues().api_key;
const ghostscriptPath = getPreferenceValues().ghostscript_path;
const cloudConvert = new CloudConvert(apiKey);

const markdown = `
  This extension requires either a CloudConvert API key or a local installation of Ghostscript.
  - Get an API key on [cloudconvert.com](https://cloudconvert.com/)

    or
  
  - Install Ghostscript via Homebrew: \`brew install ghostscript\` ([more info](https://www.ghostscript.com/))
`;

export default function Command() {
  const [isGsInstalled, setGsInstalled] = useState<boolean | null>(null);

  useEffect(() => {
    try {
      cp.exec(`${ghostscriptPath} --version`, (err) => {
        setGsInstalled(!err);
      });
    } catch (err) {
      setGsInstalled(false);
    }
  }, []);

  async function compressPdf(file: string) {
    try {
      // set loading state
      await showToast(Toast.Style.Animated, "Compressing PDF...");

      // get folder path from file
      const folderPath = file.substring(0, file.lastIndexOf("/"));
      const fileName = file.replace(/^.*[\\/]/, "");
      // add -compressed to filename
      const newFileName = fileName.replace(".pdf", "-compressed.pdf");

      if (apiKey) {
        // create task
        let job = await cloudConvert.jobs.create({
          tasks: {
            "import-file": {
              operation: "import/upload",
            },
            "compress-file": {
              operation: "optimize",
              input: ["import-file"],
              input_format: "pdf",
              engine: "3heights",
              profile: "web",
              flatten_signatures: false,
              engine_version: "6.12",
            },
            "export-file": {
              operation: "export/url",
              input: ["compress-file"],
              inline: false,
              archive_multiple_files: false,
            },
          },
          tag: "compress-pdf",
        });

        // upload file
        const uploadTask = job.tasks.filter((task) => task.name === "import-file")[0];
        const inputFile = fs.createReadStream(file);
        await cloudConvert.tasks.upload(uploadTask, inputFile, fileName);

        // get file
        job = await cloudConvert.jobs.wait(job.id);
        const convertedFile = cloudConvert.jobs.getExportUrls(job)[0];
        if (!convertedFile.url) {
          await showToast(Toast.Style.Failure, "Error", "No file found");
          return false;
        }

        // download file
        const writeStream = fs.createWriteStream(folderPath + "/" + newFileName);
        https.get(convertedFile.url, function (response) {
          response.pipe(writeStream);
        });
        await new Promise((resolve, reject) => {
          writeStream.on("finish", resolve);
          writeStream.on("error", reject);
        });
      } else if (ghostscriptPath) {
        cp.exec(
          `${ghostscriptPath} -sDEVICE=pdfwrite -dCompatibilityLevel=1.4 -dPDFSETTINGS=/ebook -dNOPAUSE -dBATCH -dColorImageResolution=150 -sOutputFile="${
            folderPath + "/" + newFileName
          }" "${file}"`,
          async (err) => {
            if (err) {
              throw err;
            }
          }
        );
      } else {
        await showToast(
          Toast.Style.Failure,
          "Error",
          "This extension requires either a CloudConvert API key or a local installation of Ghostscript."
        );
        return;
      }

      // show success toast
      await showToast(Toast.Style.Success, "PDF Compressed", "Your PDF has been compressed");
      // open folder
      open(folderPath);
      // pop to root
      popToRoot();
    } catch (error: any) {
      // show error toast
      await showToast(Toast.Style.Failure, "Error", error.message);
    }
  }

  return apiKey || isGsInstalled ? (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Compress PDF"
            onSubmit={(values) => {
              const file = values.file[0];
              if (!fs.existsSync(file) || !fs.lstatSync(file).isFile()) {
                return false;
              }
              // compress pdf
              compressPdf(file);
            }}
          />
        </ActionPanel>
      }
    >
      <Form.FilePicker id="file" allowMultipleSelection={false} />
      <Form.Description
        title="Info"
        text="When finished, your file will be placed under the same path. If using CloudConvert, you have 25 free conversion minutes daily."
      />
    </Form>
  ) : (
    <Detail
      isLoading={isGsInstalled === null}
      markdown={isGsInstalled === null ? "" : markdown}
      actions={
        <ActionPanel>
          <Action title="Open Extension Preferences" onAction={openExtensionPreferences} />
        </ActionPanel>
      }
    />
  );
}
