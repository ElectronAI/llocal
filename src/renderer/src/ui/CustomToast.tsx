import { ComponentProps } from 'react'
import { Progress } from './Progress'
import { twMerge } from 'tailwind-merge'
import { ImSpinner2 } from 'react-icons/im'

interface CustomToastProps extends ComponentProps<'div'> {
  progressValue?: number
}

export const CustomToast = ({
  className,
  children,
  progressValue,
  ...props
}: CustomToastProps): React.ReactElement => {
  return (
    <div
      className={twMerge(
        'relative w-full gap-2 space-y-4 text-background dark:text-foreground rounded-lg',
        className
      )}
      {...props}
    >
      <div className="flex items-start gap-2 ">
        <ImSpinner2 className="animate-spin text-lg my-auto" />
        <h1 className="flex-1 ">{children}</h1>
      </div>
      {/* this is unbelievably necessary, since !! typecasts progressValue to boolean and then conditionally renders, otherwise it renders 0
        it is such because, the expression 0 && <anything /> returns 0 as 0 is falsy and the ternay operator returns the left-hand value incase of the expression being false.
      */}
      {!!progressValue && <Progress value={progressValue} />}
    </div>
  )
}
