/* TYsec2026 Pwn3 - 哨兵 Sentry
 * 考点: ret2text + Stack Canary（canary 泄露：截断字节覆盖法）
 * 保护: NX 开 | Canary 开 | PIE 关
 */
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>

void backdoor(void) {
    system("/bin/sh");
}

void init(void) {
    setvbuf(stdout, NULL, _IONBF, 0);
    setvbuf(stdin,  NULL, _IONBF, 0);
    setvbuf(stderr, NULL, _IONBF, 0);
    alarm(60);
}

int vuln(void) {
    char buf[0x20];

    puts("[Sentry] Please identify yourself:");
    /* 注意: 0x29 = buf 到 canary 的距离(0x28) + 1
     * 多出来的 1 字节正好把 canary 最低位的 \x00 覆盖掉 */
    read(0, buf, 0x29);

    /* buf 没有 \x00 结尾, printf 会顺着把 canary 也打印出来 -> 泄露 */
    printf("Hello, %s\n", buf);

    puts("[Sentry] Access code please:");
    /* 第二次输入才是真正的溢出点: 填回正确 canary 后覆盖返回地址
     * 需要装下: 0x28 填充 + canary(8) + rbp(8) + ret 垫片(8) + backdoor(8) */
    read(0, buf, 0x60);
    return 0;
}

int main(void) {
    init();
    vuln();
    puts("[Sentry] Access denied. Bye.");
    return 0;
}
