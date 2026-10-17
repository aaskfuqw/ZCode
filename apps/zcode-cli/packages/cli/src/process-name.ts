export const CLI_COMMAND_NAME = "zcode-next";
export const CLI_PROCESS_NAME = "zcode-next-cli";

interface ProcessTitleTarget {
  title: string;
}

export const setCliProcessTitle = (
  target: ProcessTitleTarget = process,
): void => {
  target.title = CLI_PROCESS_NAME;
};
