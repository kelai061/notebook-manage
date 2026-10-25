using System;
using System.Diagnostics;
using System.IO;
using System.Text;

namespace PaperCardAtelier
{
    internal static class Program
    {
        [STAThread]
        private static int Main(string[] args)
        {
            try
            {
                string baseDir = AppDomain.CurrentDomain.BaseDirectory;
                string runtimeExe = Path.Combine(baseDir, "release", "PaperCardAtelier", "PaperCardAtelier.exe");

                if (!File.Exists(runtimeExe))
                {
                    Console.Error.WriteLine("[PaperCardAtelier] 未找到运行时程序: " + runtimeExe);
                    return 1;
                }

                StringBuilder argBuilder = new StringBuilder();
                bool waitExit = false;

                string runAsNode = Environment.GetEnvironmentVariable("ELECTRON_RUN_AS_NODE");
                if (!string.IsNullOrEmpty(runAsNode) && runAsNode != "0")
                {
                    waitExit = true;
                }

                for (int i = 0; i < args.Length; i++)
                {
                    string a = args[i] ?? "";
                    if (a.StartsWith("--scenario=") || a.StartsWith("--profile=") || a == "--shot" || a == "--wait")
                    {
                        waitExit = true;
                    }
                    if (i > 0) argBuilder.Append(' ');
                    argBuilder.Append(QuoteArgument(a));
                }

                ProcessStartInfo psi = new ProcessStartInfo
                {
                    FileName = runtimeExe,
                    Arguments = argBuilder.ToString(),
                    WorkingDirectory = baseDir,
                    UseShellExecute = false
                };

                psi.EnvironmentVariables["PAPERCARD_HOME"] = baseDir.TrimEnd('\\', '/');

                Process proc = Process.Start(psi);
                if (proc == null)
                {
                    return 1;
                }

                if (waitExit)
                {
                    proc.WaitForExit();
                    return proc.ExitCode;
                }

                return 0;
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("[PaperCardAtelier Launcher Error] " + ex.Message);
                return 1;
            }
        }

        private static string QuoteArgument(string arg)
        {
            if (string.IsNullOrEmpty(arg)) return "\"\"";
            if (!arg.Contains(" ") && !arg.Contains("\t") && !arg.Contains("\""))
            {
                return arg;
            }
            return "\"" + arg.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"";
        }
    }
}
