#include <stdio.h>

__attribute__((noinline))
int add_numbers(int x, int y) {
    volatile int sum = x + y;
    return sum;
}

int main(void) {
    volatile int a = 10;
    volatile int b = 20;
    int result = add_numbers(a, b);
    printf("result = %d\n", result);
    return 0;
}
