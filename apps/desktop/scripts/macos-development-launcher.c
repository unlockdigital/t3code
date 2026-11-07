#include <mach-o/dyld.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

// macOS attributes Documents access to the app through a native main executable.
int main(int argc, char **argv) {
  char executable[PATH_MAX];
  uint32_t size = sizeof(executable);
  if (_NSGetExecutablePath(executable, &size) != 0) {
    fputs("T3 Code: launcher path is too long.\n", stderr);
    return 1;
  }
  char *separator = strrchr(executable, '/');
  if (separator == NULL) {
    fputs("T3 Code: cannot locate the application bundle.\n", stderr);
    return 1;
  }
  *separator = '\0';
  char script[PATH_MAX];
  int length = snprintf(script, sizeof(script), "%s/../Resources/dev-launcher.sh", executable);
  if (length < 0 || (size_t)length >= sizeof(script)) {
    fputs("T3 Code: launcher script path is too long.\n", stderr);
    return 1;
  }
  char **arguments = calloc((size_t)argc + 2, sizeof(char *));
  if (arguments == NULL) {
    perror("T3 Code: allocating launcher arguments");
    return 1;
  }
  arguments[0] = "/bin/sh";
  arguments[1] = script;
  for (int index = 1; index < argc; index++) {
    arguments[index + 1] = argv[index];
  }
  execv(arguments[0], arguments);
  perror("T3 Code: starting launcher");
  free(arguments);
  return 1;
}
