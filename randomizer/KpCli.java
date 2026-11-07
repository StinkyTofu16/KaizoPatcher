import java.io.File;
import java.io.FileOutputStream;
import java.io.PrintStream;
import java.util.ArrayList;
import java.util.List;

/**
 * Runs the Universal Pokemon Randomizer ZX command-line mode without its GUI and without System.exit,
 * so a browser JVM can call it repeatedly. Leading options:
 *   --tmp=DIR      writable temp directory
 *   --log=FILE     send stdout/stderr to FILE
 *   --result=FILE  write the exit code to FILE when done
 *   --clean=DIR    first delete kp-* files and kptmp contents left in DIR by earlier runs
 */
public class KpCli {
    private static void deleteTree(File f) {
        File[] kids = f.listFiles();
        if (kids != null) for (File k : kids) deleteTree(k);
        f.delete();
    }

    public static void main(String[] args) throws Exception {
        String result = null;
        List<String> rest = new ArrayList<>();
        PrintStream origOut = System.out, origErr = System.err;
        PrintStream log = null;
        for (String a : args) {
            if (a.startsWith("--clean=")) {
                // Delete files left by earlier runs (outputs, logs, temp) so browser storage doesn't grow every run.
                File dir = new File(a.substring(8));
                File[] old = dir.listFiles();
                if (old != null) for (File f : old) {
                    if (f.isFile() && f.getName().startsWith("kp-")) f.delete();
                }
                File tmpDir = new File(dir, "kptmp");
                File[] tmps = tmpDir.listFiles();
                if (tmps != null) for (File f : tmps) deleteTree(f);
            } else if (a.startsWith("--tmp=")) {
                File t = new File(a.substring(6));
                t.mkdirs();
                System.setProperty("java.io.tmpdir", t.getPath());
            } else if (a.startsWith("--log=")) {
                log = new PrintStream(new FileOutputStream(a.substring(6)), true, "UTF-8");
                System.setOut(log);
                System.setErr(log);
            } else if (a.startsWith("--result=")) {
                result = a.substring(9);
            } else {
                rest.add(a);
            }
        }
        int code;
        try {
            code = com.dabomstew.pkrandom.cli.CliRandomizer.invoke(rest.toArray(new String[0]));
        } catch (Throwable t) {
            t.printStackTrace();
            code = 2;
        }
        System.out.flush();
        if (log != null) { System.setOut(origOut); System.setErr(origErr); log.close(); }
        if (result != null) {
            try (FileOutputStream f = new FileOutputStream(result)) { f.write(Integer.toString(code).getBytes("UTF-8")); }
        }
    }
}
