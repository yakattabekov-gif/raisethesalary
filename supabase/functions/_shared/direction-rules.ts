export function findCompletedInTransitStatus(statuses: any[]): any | null {
  return statuses.find((status: any) => {
    const code = status?.status?.code ?? status?.status_code ?? status?.code;
    const name = status?.status?.name ?? status?.status_name ?? status?.name;
    return (code === 206 || name === "Груз в пути") && status?.state === "completed";
  }) ?? null;
}

export function evaluateInTransitDirectionChange(input: {
  inTransitCompleted: boolean;
  currentReceiverCityName: string;
  requestedReceiverCityName: string;
  changeSender: boolean;
  changeReceiver: boolean;
  allowedChildDirectionExists: boolean;
}): { allowed: boolean; error?: string } {
  const {
    inTransitCompleted,
    currentReceiverCityName,
    requestedReceiverCityName,
    changeSender,
    changeReceiver,
    allowedChildDirectionExists,
  } = input;

  if (!inTransitCompleted) return { allowed: true };
  if (!changeSender && !changeReceiver) return { allowed: true };

  if (changeSender) {
    return {
      allowed: false,
      error: "Груз уже в пути — можно менять только дочернее направление получателя из разрешённых направлений текущего города",
    };
  }

  if (changeReceiver && allowedChildDirectionExists) {
    return { allowed: true };
  }

  return {
    allowed: false,
    error: `Груз уже в пути — смена направления разрешена только на дочерние направления города \"${currentReceiverCityName}\". \"${requestedReceiverCityName}\" не входит в разрешённые направления`,
  };
}